/**
 * Boarding pass issuance, validation and boarding — verified against the local
 * stack and the real Edge Functions.
 *
 *   pnpm db:verify:boarding
 *
 * The things that matter here and cannot be shown with a unit test:
 *
 *   - a boarding pass does not exist before payment
 *   - a forged or tampered token is refused
 *   - a ticket boards exactly ONCE, even under two simultaneous scans
 *   - a passenger cannot validate or board their own ticket
 *   - a ticket is judged against the trip being boarded: nothing boards before
 *     boarding opens or after the bus leaves, and a ticket for another bus,
 *     day or route is refused with that reason — and stays valid for its own
 *     trip, which is the whole point
 *   - crew scan only the trips they crew
 *   - boarding is per passenger: one late family member can board later
 *   - refused boardings are logged, with the door's trip, bus and scan method
 *   - the old unscoped functions are gone, not merely unused
 *
 * Requires `supabase start`.
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadVerifyEnv } from './_verify-env.mjs';

const root = path.resolve(import.meta.dirname, '..');
const { url: URL_, key: KEY } = loadVerifyEnv();
const PASSWORD = 'PalawanGo2026';

const client = () => createClient(URL_, KEY, { auth: { persistSession: false } });

async function signIn(email) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return { supabase, accessToken: data.session.access_token };
}

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function invoke(fn, body, accessToken) {
  const response = await fetch(`${URL_}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: KEY,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const passenger = await signIn('passenger@palago.test');
const other = await signIn('passenger2@palago.test');
const cherry = await signIn('operator@palago.test');
const roro = await signIn('roro@palago.test');
const driver = await signIn('driver@palago.test');
const assistant = await signIn('assistant@palago.test');
const admin = await signIn('admin@palago.test');

async function releaseAllHolds() {
  const { data: open } = await admin.supabase
    .from('bookings')
    .select('id')
    .in('status', ['PENDING', 'PAYMENT_PENDING']);
  for (const b of open ?? []) {
    await admin.supabase.rpc('cancel_booking', { p_booking_id: b.id });
  }
}
await releaseAllHolds();

/** A booking on a Cherry Bus trip, optionally carried all the way to paid. */
async function makeBooking({ paid = true, seats = 1, tripId = null } = {}) {
  // Two Cherry trips leave on the first day, so order by time as well — the
  // suite's door must be the same trip on every run.
  let query = passenger.supabase.from('trip_search').select('id, operator_code, trip_number');
  query = tripId
    ? query.eq('id', tripId)
    : query
        .eq('operator_code', 'CHERRY')
        .in('status', ['SCHEDULED', 'BOARDING'])
        .order('departure_date')
        .order('departure_time');
  const { data: trips } = await query.limit(1);
  const trip = trips[0];

  const { data: booking, error } = await passenger.supabase.rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: Array.from({ length: seats }, (_unused, i) => ({
      name: i === 0 ? 'Juan Dela Cruz' : `Passenger ${i + 1}`,
      phone: '09171234567',
      email: null,
      type: 'ADULT',
    })),
  });
  if (error) throw new Error(`create_booking: ${error.message}`);

  if (!paid) return { booking, trip };

  const created = await invoke(
    'create-test-payment',
    { bookingId: booking.bookingId },
    passenger.accessToken,
  );
  const token = new URL(created.body.data.paymentUrl).searchParams.get('t');
  const confirmed = await invoke('confirm-test-payment', {
    reference: created.body.data.reference,
    token,
  });
  if (!confirmed.body?.success) throw new Error(`confirm failed: ${JSON.stringify(confirmed.body)}`);

  return { booking, trip };
}

// ---------------------------------------------------------------------------
console.log('\nA pass is not issued before payment');
// ---------------------------------------------------------------------------
{
  const { booking } = await makeBooking({ paid: false });
  const pass = await invoke(
    'get-boarding-pass',
    { bookingId: booking.bookingId },
    passenger.accessToken,
  );
  check(
    'an unpaid booking has no boarding pass',
    pass.body?.code === 'UNPAID_BOOKING',
    pass.body?.code,
  );

  await passenger.supabase.rpc('cancel_booking', { p_booking_id: booking.bookingId });
  const afterCancel = await invoke(
    'get-boarding-pass',
    { bookingId: booking.bookingId },
    passenger.accessToken,
  );
  check(
    'a cancelled booking has no boarding pass',
    afterCancel.body?.success === false,
    afterCancel.body?.code,
  );
}

// ---------------------------------------------------------------------------
console.log('\nIssuing a pass for a paid booking');
// ---------------------------------------------------------------------------
const { booking: paidBooking, trip: paidTrip } = await makeBooking({ paid: true });

let qrPayload = null;
{
  const pass = await invoke(
    'get-boarding-pass',
    { bookingId: paidBooking.bookingId },
    passenger.accessToken,
  );
  check('a paid booking gets a pass', pass.body?.success === true, JSON.stringify(pass.body));

  const d = pass.body?.data;
  check('the payload is typed PALAGO_BOOKING', d?.type === 'PALAGO_BOOKING', d?.type);
  check('it carries the booking id', d?.bookingId === paidBooking.bookingId);
  check('it carries the reference', d?.reference === paidBooking.reference);
  check('it carries a signed token', typeof d?.token === 'string' && d.token.includes('.'));

  // Anything in a QR is readable by anyone who photographs the screen.
  const serialised = JSON.stringify(d);
  check(
    'the payload leaks no passenger name',
    !serialised.includes('Juan Dela Cruz'),
    'a passenger name is in the QR',
  );
  check('the payload leaks no seat number', !/"seat"/.test(serialised));

  qrPayload = JSON.stringify({
    type: d.type,
    bookingId: d.bookingId,
    reference: d.reference,
    token: d.token,
  });

  const notMine = await invoke(
    'get-boarding-pass',
    { bookingId: paidBooking.bookingId },
    other.accessToken,
  );
  check(
    "another passenger cannot get someone else's pass",
    notMine.body?.success === false,
    notMine.body?.code,
  );
}

// ---------------------------------------------------------------------------
console.log('\nThe door must be open');
// ---------------------------------------------------------------------------
{
  const early = await invoke('validate-qr', { payload: qrPayload, tripId: paidTrip.id }, cherry.accessToken);
  check(
    'before boarding opens, a good ticket is BOARDING_NOT_OPEN',
    early.body?.data?.result === 'BOARDING_NOT_OPEN',
    early.body?.data?.result ?? early.body?.code,
  );

  const earlyBoard = await invoke('confirm-boarding', { payload: qrPayload, tripId: paidTrip.id }, cherry.accessToken);
  check(
    'and nobody can be boarded yet',
    earlyBoard.body?.data?.boarded === false && earlyBoard.body?.data?.result === 'BOARDING_NOT_OPEN',
    JSON.stringify(earlyBoard.body?.data ?? earlyBoard.body?.code),
  );
  const { data: untouched } = await admin.supabase
    .from('bookings').select('status').eq('id', paidBooking.bookingId).single();
  check('the booking is still CONFIRMED', untouched?.status === 'CONFIRMED', untouched?.status);

  // One Cherry trip is seeded as already departed, whatever it is called today.
  const departed = (
    await admin.supabase
      .from('trips')
      .select('id')
      .in('status', ['DEPARTED', 'ON_TRIP', 'ARRIVED'])
      .eq('operator_id', (await admin.supabase.from('trips').select('operator_id').eq('id', paidTrip.id).single()).data.operator_id)
      .limit(1)
      .single()
  ).data;
  const late = await invoke('validate-qr', { payload: qrPayload, tripId: departed.id }, cherry.accessToken);
  check(
    'at a bus that has already left, it is BOARDING_CLOSED',
    late.body?.data?.result === 'BOARDING_CLOSED',
    late.body?.data?.result ?? late.body?.code,
  );

  const opened = await cherry.supabase.rpc('set_trip_boarding', { p_trip_id: paidTrip.id });
  check(
    'the operator opens boarding',
    !opened.error && opened.data?.status === 'BOARDING',
    opened.error?.message ?? JSON.stringify(opened.data),
  );
}

// ---------------------------------------------------------------------------
console.log('\nWho may scan');
// ---------------------------------------------------------------------------
{
  const asPassenger = await invoke('validate-qr', { payload: qrPayload, tripId: paidTrip.id }, passenger.accessToken);
  check(
    'a passenger cannot validate a ticket, even their own',
    asPassenger.body?.success === false && asPassenger.body?.code === 'FORBIDDEN',
    asPassenger.body?.code ?? JSON.stringify(asPassenger.body?.data),
  );

  const asRoro = await invoke('validate-qr', { payload: qrPayload, tripId: paidTrip.id }, roro.accessToken);
  check(
    "a rival operator cannot validate another operator's ticket",
    asRoro.body?.success === false && asRoro.body?.code === 'FORBIDDEN',
    asRoro.body?.code,
  );

  const anon = await invoke('validate-qr', { payload: qrPayload, tripId: paidTrip.id });
  check('an anonymous caller cannot validate', anon.body?.success === false, `${anon.status}`);

  const asDriver = await invoke('validate-qr', { payload: qrPayload, tripId: paidTrip.id }, driver.accessToken);
  check(
    'the assigned operator\'s driver can validate',
    asDriver.body?.data?.valid === true,
    asDriver.body?.data?.result ?? asDriver.body?.code,
  );

  const asAssistant = await invoke('validate-qr', { payload: qrPayload, tripId: paidTrip.id }, assistant.accessToken);
  check(
    "the trip's assigned assistant can validate",
    asAssistant.body?.data?.valid === true,
    asAssistant.body?.data?.result ?? asAssistant.body?.code,
  );

  // Take the crew off this trip — an ordinary operator action — and the same
  // driver can no longer scan at its door. Before, any driver of the operator
  // could scan any of its trips.
  const crew = (
    await cherry.supabase.from('trip_assignments').select('id, status')
      .eq('trip_id', paidTrip.id).neq('status', 'CANCELLED').single()
  ).data;
  await cherry.supabase.from('trip_assignments').update({ status: 'CANCELLED' }).eq('id', crew.id);
  const offDuty = await invoke('validate-qr', { payload: qrPayload, tripId: paidTrip.id }, driver.accessToken);
  check(
    'a driver not crewing this trip cannot scan at its door',
    offDuty.body?.success === false && offDuty.body?.code === 'FORBIDDEN',
    offDuty.body?.code ?? offDuty.body?.data?.result,
  );
  await cherry.supabase.from('trip_assignments').update({ status: crew.status }).eq('id', crew.id);
}

// ---------------------------------------------------------------------------
console.log('\nForgery and tampering');
// ---------------------------------------------------------------------------
{
  const garbage = await invoke('validate-qr', { payload: 'not json at all', tripId: paidTrip.id }, cherry.accessToken);
  check(
    'a non-PalaGo QR is reported invalid, not an error',
    garbage.body?.data?.result === 'INVALID_QR',
    JSON.stringify(garbage.body),
  );

  const wrongType = await invoke(
    'validate-qr',
    { payload: JSON.stringify({ type: 'SOMETHING_ELSE', bookingId: 'x', reference: 'y', token: 'z' }), tripId: paidTrip.id },
    cherry.accessToken,
  );
  check('a QR of the wrong type is invalid', wrongType.body?.data?.result === 'INVALID_QR');

  const parsed = JSON.parse(qrPayload);

  const noSignature = await invoke(
    'validate-qr',
    { payload: JSON.stringify({ ...parsed, token: 'made.up' }), tripId: paidTrip.id },
    cherry.accessToken,
  );
  check('an unsigned token is invalid', noSignature.body?.data?.result === 'INVALID_QR');

  // Change the FIRST character of the signature: all six of its bits are real.
  // (This used to flip the last character, whose low two bits are padding for
  // a 32-byte HMAC — so one run in sixteen the "tampered" signature decoded to
  // the same bytes and the check failed. It was blamed on a cold container.)
  const [tokenBody, signature] = parsed.token.split('.');
  const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  const tampered = await invoke(
    'validate-qr',
    { payload: JSON.stringify({ ...parsed, token: `${tokenBody}.${flipped}` }), tripId: paidTrip.id },
    cherry.accessToken,
  );
  check('a tampered signature is invalid', tampered.body?.data?.result === 'INVALID_QR',
    tampered.body?.data?.result);

  // The same signature, spelled differently: raise the final character by one.
  // Its low bits are unused, so this is always the same bytes in a
  // non-canonical spelling — and it must still be refused.
  const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const respelled = signature.slice(0, -1) + B64URL[B64URL.indexOf(signature.at(-1)) + 1];
  const alias = await invoke(
    'validate-qr',
    { payload: JSON.stringify({ ...parsed, token: `${tokenBody}.${respelled}` }), tripId: paidTrip.id },
    cherry.accessToken,
  );
  check('a respelling of a real signature is refused', alias.body?.data?.result === 'INVALID_QR',
    alias.body?.data?.result);

  // Keep the real signature but claim a different booking in the outer JSON.
  const swapped = await invoke(
    'validate-qr',
    {
      payload: JSON.stringify({
        ...parsed,
        bookingId: '00000000-0000-0000-0000-000000000000',
      }),
      tripId: paidTrip.id,
    },
    cherry.accessToken,
  );
  check(
    'rewriting the booking id around a real signature is invalid',
    swapped.body?.data?.result === 'INVALID_QR',
    swapped.body?.data?.result,
  );
}

// ---------------------------------------------------------------------------
console.log('\nA valid ticket');
// ---------------------------------------------------------------------------
{
  const valid = await invoke('validate-qr', { payload: qrPayload, tripId: paidTrip.id }, cherry.accessToken);
  const d = valid.body?.data;

  check('a paid, confirmed ticket is VALID', d?.result === 'VALID' && d?.valid === true, d?.result);
  check('the scanner is told the passenger name', d?.passengers?.[0]?.name === 'Juan Dela Cruz');
  check('and the seat', Boolean(d?.passengers?.[0]?.seat));
  check('and that payment is PAID', d?.paymentStatus === 'PAID', d?.paymentStatus);
  check('and the route', d?.originCode === 'PPS' || Boolean(d?.originCode), d?.originCode);

}

/**
 * The trips these tests need, found by how they relate to the door — never by
 * name. Seeded trip numbers embed the date they were generated for, so a
 * hardcoded one is correct for exactly one day.
 */
async function relatedTrips(door) {
  const { data: all } = await admin.supabase
    .from('trips')
    .select('id, trip_number, route_id, operator_id, departure_date, status');
  const here = all.find((t) => t.id === door.id);

  const sameOperator = all.filter((t) => t.operator_id === here.operator_id && t.id !== here.id);
  return {
    sameRouteSameDay: sameOperator.find(
      (t) => t.route_id === here.route_id && t.departure_date === here.departure_date,
    ),
    sameRouteOtherDay: sameOperator.find(
      (t) => t.route_id === here.route_id && t.departure_date !== here.departure_date,
    ),
    otherRoute: sameOperator.find((t) => t.route_id !== here.route_id),
    rivalOperator: all.find((t) => t.operator_id !== here.operator_id),
    alreadyGone: sameOperator.find((t) => ['DEPARTED', 'ON_TRIP', 'ARRIVED'].includes(t.status)),
  };
}

// ---------------------------------------------------------------------------
console.log('\nA good ticket at the wrong door');
// ---------------------------------------------------------------------------
// Every ticket below is genuine, paid and signed; only the door is wrong. The
// other trips stay SCHEDULED — they are never opened — so later suites still
// have them. Only the suite’s own door is boarding.
{
  const related = await relatedTrips(paidTrip);

  const ticketFor = async (tripId) => {
    const { booking, trip } = await makeBooking({ paid: true, tripId });
    const pass = await invoke('get-boarding-pass', { bookingId: booking.bookingId }, passenger.accessToken);
    const d = pass.body.data;
    return {
      booking,
      trip,
      payload: JSON.stringify({ type: d.type, bookingId: d.bookingId, reference: d.reference, token: d.token }),
    };
  };

  const cases = [
    [related.sameRouteSameDay, 'WRONG_BUS', 'another bus on the same route today'],
    [related.sameRouteOtherDay, 'WRONG_DATE', 'the same route on another day'],
    [related.otherRoute, 'WRONG_ROUTE', 'a different route'],
  ];

  let wrongDate = null;
  for (const [other, expected, what] of cases) {
    check(`a trip exists for the ${expected} case (seed data)`, Boolean(other), 'none found');
    if (!other) continue;
    const t = await ticketFor(other.id);
    const v = await invoke('validate-qr', { payload: t.payload, tripId: paidTrip.id }, cherry.accessToken);
    check(`a ticket for ${what} is ${expected}`, v.body?.data?.result === expected,
      v.body?.data?.result ?? v.body?.code);
    check('  and the scanner is told which trip it is for',
      v.body?.data?.tripNumber === other.trip_number, v.body?.data?.tripNumber);
    check('  without the passenger list', (v.body?.data?.passengers ?? []).length === 0);

    const b = await invoke('confirm-boarding', { payload: t.payload, tripId: paidTrip.id }, cherry.accessToken);
    check('  and it cannot be boarded here',
      b.body?.data?.boarded === false && b.body?.data?.result === expected,
      JSON.stringify(b.body?.data ?? b.body?.code));

    // The lockout this prevents: boarding it here would make its own bus
    // answer ALREADY_BOARDED when the passenger turns up.
    const { data: bk } = await admin.supabase.from('bookings').select('status').eq('id', t.booking.bookingId).single();
    const { data: pax } = await admin.supabase.from('booking_passengers').select('boarded_at').eq('booking_id', t.booking.bookingId);
    check('  so it is still good for its own trip',
      bk?.status === 'CONFIRMED' && (pax ?? []).every((p) => p.boarded_at === null), bk?.status);

    if (expected === 'WRONG_DATE') wrongDate = t;
  }

  const rival = await ticketFor(related.rivalOperator.id);
  const r = await invoke('validate-qr', { payload: rival.payload, tripId: paidTrip.id }, cherry.accessToken);
  check("a rival operator's ticket is WRONG_TRIP", r.body?.data?.result === 'WRONG_TRIP',
    r.body?.data?.result ?? r.body?.code);
  check('  and reveals no reference, trip or passengers',
    !r.body?.data?.bookingReference && !r.body?.data?.tripNumber && !r.body?.data?.passengers,
    JSON.stringify(r.body?.data));

  // Refusals used to `raise` after writing the scan row, which rolled it back.
  const { data: log } = await admin.supabase
    .from('qr_scans')
    .select('trip_id, ticket_trip_id, bus_id, scan_method, result')
    .eq('booking_id', wrongDate.booking.bookingId)
    .eq('scan_type', 'BOARDING')
    .single();
  const doorBus = (await admin.supabase.from('trips').select('bus_id').eq('id', paidTrip.id).single()).data.bus_id;
  check('a refused boarding is logged, not rolled back', log?.result === 'WRONG_DATE', JSON.stringify(log));
  check('  against the trip being boarded', log?.trip_id === paidTrip.id);
  check("  with the ticket's own trip beside it", log?.ticket_trip_id === wrongDate.trip.id);
  check("  on the boarding trip's bus", log?.bus_id === doorBus);
  check('  and how the ticket was presented', log?.scan_method === 'QR', log?.scan_method);
}

// ---------------------------------------------------------------------------
console.log('\nBoarding, exactly once');
// ---------------------------------------------------------------------------
{
  // Two operators scanning the same ticket at the same instant.
  const CALLERS = 6;
  const attempts = Array.from({ length: CALLERS }, (_, i) =>
    invoke('confirm-boarding', { payload: qrPayload, tripId: paidTrip.id }, i % 2 === 0 ? cherry.accessToken : driver.accessToken),
  );
  const results = await Promise.all(attempts);

  const boarded = results.filter((r) => r.body?.data?.boarded === true);
  const refused = results.filter((r) => r.body?.data?.alreadyBoarded === true);

  check(
    `exactly one of ${CALLERS} simultaneous scans boards the passenger`,
    boarded.length === 1,
    `${boarded.length} boarded`,
  );
  check(
    'the rest are told ALREADY_BOARDED',
    refused.length === CALLERS - 1,
    `${refused.length} refused, others: ${results.filter((r) => !r.body?.data).map((r) => r.body?.code).join(', ')}`,
  );

  const { data: b } = await admin.supabase
    .from('bookings')
    .select('status, boarded_at, checked_in_at')
    .eq('id', paidBooking.bookingId)
    .single();
  check('the booking is BOARDED', b?.status === 'BOARDED', b?.status);
  check('boarded_at is set', Boolean(b?.boarded_at));
  check('checked_in_at is set too', Boolean(b?.checked_in_at));

  const later = await invoke('validate-qr', { payload: qrPayload, tripId: paidTrip.id }, cherry.accessToken);
  check(
    'validating afterwards reports ALREADY_BOARDED',
    later.body?.data?.result === 'ALREADY_BOARDED',
    later.body?.data?.result,
  );

  const { data: scans } = await admin.supabase
    .from('qr_scans')
    .select('scan_type, result')
    .eq('booking_id', paidBooking.bookingId);
  check('every scan was logged, successes and failures alike', (scans?.length ?? 0) >= CALLERS);
  check(
    'exactly one BOARDING scan succeeded',
    scans?.filter((s) => s.scan_type === 'BOARDING' && s.result === 'VALID').length === 1,
    JSON.stringify(scans?.filter((s) => s.scan_type === 'BOARDING').map((s) => s.result)),
  );

  const { data: audit } = await admin.supabase
    .from('audit_logs')
    .select('action')
    .eq('entity_id', paidBooking.bookingId)
    .eq('action', 'BOARDING_CONFIRMED');
  check('boarding was audited once', audit?.length === 1, `${audit?.length}`);
}

// ---------------------------------------------------------------------------
console.log('\nA family where one person is late');
// ---------------------------------------------------------------------------
{
  const { booking } = await makeBooking({ paid: true, seats: 2 });
  const pass = await invoke('get-boarding-pass', { bookingId: booking.bookingId }, passenger.accessToken);
  const d = pass.body.data;
  const payload = JSON.stringify({ type: d.type, bookingId: d.bookingId, reference: d.reference, token: d.token });
  const scan = (extra = {}) =>
    invoke('confirm-boarding', { payload, tripId: paidTrip.id, ...extra }, cherry.accessToken);
  const boardedCount = async () =>
    (await cherry.supabase.from('operator_trip_overview').select('boarded_count').eq('id', paidTrip.id).single())
      .data?.boarded_count;

  const v = (await invoke('validate-qr', { payload, tripId: paidTrip.id }, cherry.accessToken)).body?.data;
  check('the scanner lists both passengers, neither boarded',
    v?.passengers?.length === 2 && v.passengers.every((p) => p.id && p.boardedAt === null),
    JSON.stringify(v?.passengers));

  const [first, second] = v.passengers.map((p) => p.id);
  const before = await boardedCount();

  const one = (await scan({ passengerIds: [first] })).body?.data;
  check('boarding one passenger boards only that one',
    one?.boarded === true && one.boardedPassengers === 1 && one.remaining === 1, JSON.stringify(one));

  const { data: pax } = await admin.supabase
    .from('booking_passengers').select('id, boarded_at, boarded_by').eq('booking_id', booking.bookingId);
  const p1 = pax.find((p) => p.id === first);
  const p2 = pax.find((p) => p.id === second);
  check('  with their boarding time and who scanned them', Boolean(p1?.boarded_at && p1?.boarded_by));
  check('  and the other still to board', p2?.boarded_at === null);
  check('the trip counts one more boarded, not two', (await boardedCount()) === before + 1,
    `${before} -> ${await boardedCount()}`);

  const { data: manifest } = await cherry.supabase
    .from('operator_manifest').select('boarded_at').eq('booking_id', booking.bookingId);
  check('the manifest shows one boarded and one not',
    manifest?.length === 2 && manifest.filter((m) => m.boarded_at).length === 1);

  const again = (await invoke('validate-qr', { payload, tripId: paidTrip.id }, cherry.accessToken)).body?.data;
  check('the ticket is still VALID for the one who is late', again?.result === 'VALID', again?.result);

  const stranger = await scan({ passengerIds: ['00000000-0000-0000-0000-000000000000'] });
  check('naming someone who is not on the booking is refused',
    stranger.body?.success === false && stranger.body?.code === 'VALIDATION_ERROR',
    stranger.body?.code ?? JSON.stringify(stranger.body?.data));

  const rest = (await scan()).body?.data;
  check('boarding "everyone" boards just the late passenger',
    rest?.boarded === true && rest.boardedPassengers === 1 && rest.remaining === 0, JSON.stringify(rest));

  const done = (await invoke('validate-qr', { payload, tripId: paidTrip.id }, cherry.accessToken)).body?.data;
  check('then the ticket is ALREADY_BOARDED', done?.result === 'ALREADY_BOARDED', done?.result);

  const { data: audits } = await admin.supabase
    .from('audit_logs').select('id').eq('entity_id', booking.bookingId).eq('action', 'BOARDING_CONFIRMED');
  check('each of the two boardings was audited', audits?.length === 2, `${audits?.length}`);
}

// ---------------------------------------------------------------------------
console.log('\nAn unpaid ticket cannot board');
// ---------------------------------------------------------------------------
{
  // Issue a real pass, then pull the payment out from under it — the closest
  // thing to someone reusing a screenshot of an old, now-refunded ticket.
  const { booking } = await makeBooking({ paid: true });
  const pass = await invoke(
    'get-boarding-pass',
    { bookingId: booking.bookingId },
    passenger.accessToken,
  );
  const stolen = JSON.stringify({
    type: 'PALAGO_BOOKING',
    bookingId: pass.body.data.bookingId,
    reference: pass.body.data.reference,
    token: pass.body.data.token,
  });

  await passenger.supabase.rpc('refund_test_payment', { p_booking_id: booking.bookingId });

  const afterRefund = await invoke('validate-qr', { payload: stolen, tripId: paidTrip.id }, cherry.accessToken);
  check(
    'a refunded ticket is refused despite a genuine signature',
    afterRefund.body?.data?.result === 'BOOKING_CANCELLED',
    afterRefund.body?.data?.result,
  );

  const boardRefunded = await invoke('confirm-boarding', { payload: stolen, tripId: paidTrip.id }, cherry.accessToken);
  check(
    'and it cannot be boarded',
    boardRefunded.body?.data?.boarded === false && boardRefunded.body?.data?.result === 'BOOKING_CANCELLED',
    JSON.stringify(boardRefunded.body?.data ?? boardRefunded.body?.code),
  );

  const { data: refusal } = await admin.supabase
    .from('qr_scans').select('result').eq('booking_id', booking.bookingId).eq('scan_type', 'BOARDING');
  check(
    'and the refused attempt is on record',
    refusal?.length === 1 && refusal[0].result === 'BOOKING_CANCELLED',
    JSON.stringify(refusal),
  );
}

// ---------------------------------------------------------------------------
console.log('\nExpired pass');
// ---------------------------------------------------------------------------
{
  const { booking } = await makeBooking({ paid: true });
  const pass = await invoke(
    'get-boarding-pass',
    { bookingId: booking.bookingId },
    passenger.accessToken,
  );

  // Forge an expiry in the past using the real secret, which is what an
  // expired-but-authentic pass looks like 48 hours after issue.
  const secretLine = fs
    .readFileSync(path.join(root, 'supabase/functions/.env'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('QR_SIGNING_SECRET='));
  const secret = secretLine.split('=')[1].trim();

  const expiredToken = execSync(
    `node -e "const c=require('crypto');` +
      `const p=Buffer.from(JSON.stringify({bid:'${pass.body.data.bookingId}',ref:'${pass.body.data.reference}',iat:1,exp:2})).toString('base64url');` +
      `const s=c.createHmac('sha256','${secret}').update(p).digest('base64url');` +
      `console.log(p+'.'+s)"`,
    { encoding: 'utf8' },
  ).trim();

  const expired = await invoke(
    'validate-qr',
    {
      payload: JSON.stringify({
        type: 'PALAGO_BOOKING',
        bookingId: pass.body.data.bookingId,
        reference: pass.body.data.reference,
        token: expiredToken,
      }),
      tripId: paidTrip.id,
    },
    cherry.accessToken,
  );
  check(
    'an authentic but expired pass reports QR_EXPIRED',
    expired.body?.data?.result === 'QR_EXPIRED',
    expired.body?.data?.result,
  );
}

// ---------------------------------------------------------------------------
console.log('\nNo way around the door');
// ---------------------------------------------------------------------------
{
  // Replaced, not overloaded: an old version left in place would still be
  // callable over RPC with no trip at all.
  const direct = await cherry.supabase.rpc('confirm_boarding', { p_booking_id: paidBooking.bookingId });
  check('the old one-argument confirm_boarding is gone', Boolean(direct.error), 'it is still callable');

  const noTrip = await cherry.supabase.rpc('validate_booking_qr', {
    p_booking_id: paidBooking.bookingId,
    p_reference: paidBooking.reference,
  });
  check('validating without a trip is refused', Boolean(noTrip.error), 'it answered');

  const noTripFn = await invoke('validate-qr', { payload: qrPayload }, cherry.accessToken);
  check('and so is scanning without one', noTripFn.body?.code === 'VALIDATION_ERROR', noTripFn.body?.code);
}

await releaseAllHolds();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
