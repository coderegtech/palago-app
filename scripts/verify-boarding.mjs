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
 *
 * Requires `supabase start`.
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
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
async function makeBooking({ paid, seats = 1 } = { paid: true }) {
  const { data: trips } = await passenger.supabase
    .from('trip_search')
    .select('id, operator_code, trip_number')
    .eq('operator_code', 'CHERRY')
    .in('status', ['SCHEDULED', 'BOARDING'])
    .order('departure_date')
    .limit(1);
  const trip = trips[0];

  const { data: free } = await passenger.supabase
    .from('trip_seats')
    .select('seat_id')
    .eq('trip_id', trip.id)
    .eq('status', 'AVAILABLE')
    .limit(seats);

  const { data: booking, error } = await passenger.supabase.rpc('reserve_seats', {
    p_trip_id: trip.id,
    p_passengers: free.map((s, i) => ({
      seatId: s.seat_id,
      name: i === 0 ? 'Juan Dela Cruz' : `Passenger ${i + 1}`,
      phone: '09171234567',
      email: null,
      type: 'ADULT',
    })),
  });
  if (error) throw new Error(`reserve_seats: ${error.message}`);

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
console.log('\nWho may scan');
// ---------------------------------------------------------------------------
{
  const asPassenger = await invoke('validate-qr', { payload: qrPayload }, passenger.accessToken);
  check(
    'a passenger cannot validate a ticket, even their own',
    asPassenger.body?.success === false && asPassenger.body?.code === 'FORBIDDEN',
    asPassenger.body?.code ?? JSON.stringify(asPassenger.body?.data),
  );

  const asRoro = await invoke('validate-qr', { payload: qrPayload }, roro.accessToken);
  check(
    "a rival operator cannot validate another operator's ticket",
    asRoro.body?.success === false && asRoro.body?.code === 'FORBIDDEN',
    asRoro.body?.code,
  );

  const anon = await invoke('validate-qr', { payload: qrPayload });
  check('an anonymous caller cannot validate', anon.body?.success === false, `${anon.status}`);

  const asDriver = await invoke('validate-qr', { payload: qrPayload }, driver.accessToken);
  check(
    'the assigned operator\'s driver can validate',
    asDriver.body?.data?.valid === true,
    asDriver.body?.data?.result ?? asDriver.body?.code,
  );
}

// ---------------------------------------------------------------------------
console.log('\nForgery and tampering');
// ---------------------------------------------------------------------------
{
  const garbage = await invoke('validate-qr', { payload: 'not json at all' }, cherry.accessToken);
  check(
    'a non-PalaGo QR is reported invalid, not an error',
    garbage.body?.data?.result === 'INVALID_QR',
    JSON.stringify(garbage.body),
  );

  const wrongType = await invoke(
    'validate-qr',
    { payload: JSON.stringify({ type: 'SOMETHING_ELSE', bookingId: 'x', reference: 'y', token: 'z' }) },
    cherry.accessToken,
  );
  check('a QR of the wrong type is invalid', wrongType.body?.data?.result === 'INVALID_QR');

  const parsed = JSON.parse(qrPayload);

  const noSignature = await invoke(
    'validate-qr',
    { payload: JSON.stringify({ ...parsed, token: 'made.up' }) },
    cherry.accessToken,
  );
  check('an unsigned token is invalid', noSignature.body?.data?.result === 'INVALID_QR');

  // Flip the last character of the signature.
  const [tokenBody, signature] = parsed.token.split('.');
  const flipped = signature.slice(0, -1) + (signature.at(-1) === 'A' ? 'B' : 'A');
  const tampered = await invoke(
    'validate-qr',
    { payload: JSON.stringify({ ...parsed, token: `${tokenBody}.${flipped}` }) },
    cherry.accessToken,
  );
  check('a tampered signature is invalid', tampered.body?.data?.result === 'INVALID_QR');

  // Keep the real signature but claim a different booking in the outer JSON.
  const swapped = await invoke(
    'validate-qr',
    {
      payload: JSON.stringify({
        ...parsed,
        bookingId: '00000000-0000-0000-0000-000000000000',
      }),
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
  const valid = await invoke('validate-qr', { payload: qrPayload }, cherry.accessToken);
  const d = valid.body?.data;

  check('a paid, confirmed ticket is VALID', d?.result === 'VALID' && d?.valid === true, d?.result);
  check('the scanner is told the passenger name', d?.passengers?.[0]?.name === 'Juan Dela Cruz');
  check('and the seat', Boolean(d?.passengers?.[0]?.seat));
  check('and that payment is PAID', d?.paymentStatus === 'PAID', d?.paymentStatus);
  check('and the route', d?.originCode === 'PPS' || Boolean(d?.originCode), d?.originCode);

  const wrongTrip = await invoke(
    'validate-qr',
    { payload: qrPayload, expectedTripId: '00000000-0000-0000-0000-000000000000' },
    cherry.accessToken,
  );
  check(
    'a ticket for another trip is WRONG_TRIP',
    wrongTrip.body?.data?.result === 'WRONG_TRIP',
    wrongTrip.body?.data?.result,
  );

  const rightTrip = await invoke(
    'validate-qr',
    { payload: qrPayload, expectedTripId: paidTrip.id },
    cherry.accessToken,
  );
  check('the matching trip is still VALID', rightTrip.body?.data?.result === 'VALID');
}

// ---------------------------------------------------------------------------
console.log('\nBoarding, exactly once');
// ---------------------------------------------------------------------------
{
  // Two operators scanning the same ticket at the same instant.
  const CALLERS = 6;
  const attempts = Array.from({ length: CALLERS }, (_, i) =>
    invoke('confirm-boarding', { payload: qrPayload }, i % 2 === 0 ? cherry.accessToken : driver.accessToken),
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

  const later = await invoke('validate-qr', { payload: qrPayload }, cherry.accessToken);
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

  const afterRefund = await invoke('validate-qr', { payload: stolen }, cherry.accessToken);
  check(
    'a refunded ticket is invalid despite a genuine signature',
    afterRefund.body?.data?.result === 'INVALID_QR',
    afterRefund.body?.data?.result,
  );

  const boardRefunded = await invoke('confirm-boarding', { payload: stolen }, cherry.accessToken);
  check(
    'and it cannot be boarded',
    boardRefunded.body?.success === false,
    JSON.stringify(boardRefunded.body?.data ?? boardRefunded.body?.code),
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
    },
    cherry.accessToken,
  );
  check(
    'an authentic but expired pass reports QR_EXPIRED',
    expired.body?.data?.result === 'QR_EXPIRED',
    expired.body?.data?.result,
  );
}

await releaseAllHolds();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
