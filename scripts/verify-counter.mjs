/**
 * The counter: selling a seat to somebody standing in front of you.
 *
 *   pnpm db:verify:counter
 *
 * What this exists to prove, none of which a unit test can show:
 *
 *   - a passenger cannot create an ownerless booking, choose a seat, or mark
 *     anything paid — in cash or otherwise. That last one is the whole point:
 *     cash is the first payment in this build that corresponds to real money,
 *     so "who may say it arrived" has to be exactly one kind of account.
 *   - a rival operator cannot sell, or take payment, on someone else's trip
 *   - a cash payment records who took it, how much, when, and against which
 *     booking — the only record that the money exists
 *   - taking the fare twice is impossible: a second "cash received" returns the
 *     same receipt instead of charging again
 *   - a walk-in with no account can be sold a seat, handed a printed ticket,
 *     scanned at the door and carried to the end of the trip — and ending that
 *     trip does not fall over trying to give loyalty points to nobody
 *
 * Runs on RoRo trips with the RoRo operator, which no other suite touches, so
 * it neither consumes nor depends on their seed state.
 *
 * Requires `supabase start`.
 */

import { createClient } from '@supabase/supabase-js';
import { loadVerifyEnv } from './_verify-env.mjs';
import { makeInvoke } from './_verify-invoke.mjs';

const { url: URL_, key: KEY } = loadVerifyEnv();
const PASSWORD = 'PalawanGo2026';

const client = () => createClient(URL_, KEY, { auth: { persistSession: false } });

async function signIn(email) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return { supabase, accessToken: data.session.access_token, userId: data.user.id };
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

const invoke = makeInvoke(URL_, KEY);

const roro = await signIn('roro@palago.test');
const cherry = await signIn('operator@palago.test');
const passenger = await signIn('passenger@palago.test');
const admin = await signIn('admin@palago.test');

// ---------------------------------------------------------------------------
// A RoRo trip with room on it.
// ---------------------------------------------------------------------------

const trip = (
  await roro.supabase
    .from('operator_trip_overview')
    .select('id, trip_number, fare, status, seatsAvailable:seats_available')
    .eq('status', 'SCHEDULED')
    .order('departure_date')
    .limit(1)
).data?.[0];

if (!trip) {
  check('a SCHEDULED RoRo trip exists (seed data)', false, 'none found');
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}
check(`a SCHEDULED RoRo trip exists (${trip.trip_number})`, true);

const freeSeats = async (n) =>
  (
    (
      await roro.supabase
        .from('trip_seats')
        .select('seat_id')
        .eq('trip_id', trip.id)
        .eq('status', 'AVAILABLE')
        .limit(n)
    ).data ?? []
  ).map((r) => r.seat_id);

const walkIns = (count) =>
  Array.from({ length: count }, (_unused, i) => ({
    name: i === 0 ? 'Lola Remedios' : `Walk-in ${i + 1}`,
    phone: '09171234567',
    type: 'ADULT',
  }));

const sell = async (session, seats, extra = {}) =>
  session.supabase.rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: walkIns(seats.length),
    p_seat_ids: seats,
    p_walk_in: true,
    p_source: 'OPERATOR',
    p_ticket_type: 'PRINTED',
    ...extra,
  });

// ---------------------------------------------------------------------------
console.log('\nWho may sell at a counter');
// ---------------------------------------------------------------------------
{
  const seats = await freeSeats(1);

  const byPassenger = await sell(passenger, seats);
  check(
    'a passenger cannot create a booking with no account holder',
    byPassenger.error?.message === 'FORBIDDEN',
    byPassenger.error?.message ?? 'the call succeeded',
  );

  const byRival = await sell(cherry, seats);
  check(
    "a rival operator cannot sell on another operator's trip",
    byRival.error?.message === 'FORBIDDEN',
    byRival.error?.message ?? 'the call succeeded',
  );

  const anon = await sell({ supabase: client() }, seats);
  check('an anonymous caller cannot sell', Boolean(anon.error), 'the call succeeded');
}

// ---------------------------------------------------------------------------
console.log('\nThe counter sale');
// ---------------------------------------------------------------------------
const sale = await sell(roro, await freeSeats(2));
check('the operator can sell two seats to a walk-in', !sale.error, sale.error?.message);

let booking = null;
if (!sale.error) {
  booking = sale.data;
  const row = (
    await admin.supabase
      .from('bookings')
      .select('user_id, created_by, source, ticket_type, status, total_amount')
      .eq('id', booking.bookingId)
      .single()
  ).data;

  check('the booking has no account holder', row?.user_id === null, String(row?.user_id));
  check('but records the clerk who made it', row?.created_by === roro.userId, String(row?.created_by));
  check('it is marked as sold at a counter', row?.source === 'OPERATOR', row?.source);
  check('and as a printed ticket', row?.ticket_type === 'PRINTED', row?.ticket_type);
  check('it opens unpaid', row?.status === 'PAYMENT_PENDING', row?.status);
  check('priced at two fares', row?.total_amount === trip.fare * 2, `${row?.total_amount}`);

  const held = (
    await admin.supabase.from('trip_seats').select('status').eq('booking_id', booking.bookingId)
  ).data ?? [];
  check('the two chosen seats are held', held.length === 2 && held.every((s) => s.status === 'HELD'),
    JSON.stringify(held.map((s) => s.status)));

  const people = (
    await admin.supabase.from('booking_passengers').select('seat_id').eq('booking_id', booking.bookingId)
  ).data ?? [];
  check('nobody has a seat number yet — the fare is unpaid',
    people.length === 2 && people.every((p) => p.seat_id === null),
    JSON.stringify(people.map((p) => p.seat_id)));

  const seen = (
    await passenger.supabase.from('bookings').select('id').eq('id', booking.bookingId)
  ).data ?? [];
  check('a signed-in passenger cannot see somebody else’s counter booking', seen.length === 0,
    `saw ${seen.length}`);
}

// ---------------------------------------------------------------------------
console.log('\nWho may take the fare');
// ---------------------------------------------------------------------------
if (booking) {
  const byPassenger = await passenger.supabase.rpc('record_counter_payment', {
    p_booking_id: booking.bookingId,
    p_method: 'CASH',
  });
  check(
    'a passenger cannot mark a booking paid in cash',
    byPassenger.error?.message === 'FORBIDDEN',
    byPassenger.error?.message ?? 'the call succeeded',
  );

  const byRival = await cherry.supabase.rpc('record_counter_payment', {
    p_booking_id: booking.bookingId,
    p_method: 'CASH',
  });
  check(
    "a rival operator cannot take the fare on someone else's booking",
    byRival.error?.message === 'FORBIDDEN',
    byRival.error?.message ?? 'the call succeeded',
  );

  const stillUnpaid = (
    await admin.supabase.from('bookings').select('status').eq('id', booking.bookingId).single()
  ).data;
  check('and the booking is still unpaid after those attempts',
    stillUnpaid?.status === 'PAYMENT_PENDING', stillUnpaid?.status);

  const wallet = await roro.supabase.rpc('record_counter_payment', {
    p_booking_id: booking.bookingId,
    p_method: 'TEST_WALLET',
  });
  check(
    'a clerk cannot spend a passenger’s wallet for them',
    wallet.error?.message === 'VALIDATION_ERROR',
    wallet.error?.message ?? 'the call succeeded',
  );
}

// ---------------------------------------------------------------------------
console.log('\nCash received');
// ---------------------------------------------------------------------------
if (booking) {
  const paid = await roro.supabase.rpc('record_counter_payment', {
    p_booking_id: booking.bookingId,
    p_method: 'CASH',
  });
  check('the clerk records the cash', !paid.error, paid.error?.message);
  check('the booking is CONFIRMED', paid.data?.status === 'CONFIRMED', paid.data?.status);
  check('a receipt number comes back', /^RCP-\d{4}-\d{6}$/.test(paid.data?.receiptNumber ?? ''),
    paid.data?.receiptNumber);

  const payment = (
    await admin.supabase
      .from('payments')
      .select('provider, method, received_by, amount, status, paid_at, receipt_number')
      .eq('booking_id', booking.bookingId)
      .eq('status', 'PAID')
      .single()
  ).data;
  check('the payment is recorded as cash', payment?.method === 'CASH', payment?.method);
  check('with CASH as the provider, not a mock one', payment?.provider === 'CASH', payment?.provider);
  check('naming the person who took it', payment?.received_by === roro.userId, String(payment?.received_by));
  check('for the full fare', payment?.amount === trip.fare * 2, `${payment?.amount}`);
  check('and the time it was taken', Boolean(payment?.paid_at));

  const receipt = (
    await admin.supabase.from('receipts').select('payment_method, amount').eq('booking_id', booking.bookingId).single()
  ).data;
  check('the receipt says it was cash', receipt?.payment_method === 'Cash', receipt?.payment_method);

  const seats = (
    await admin.supabase.from('trip_seats').select('status').eq('booking_id', booking.bookingId)
  ).data ?? [];
  check('the seats are now BOOKED', seats.every((s) => s.status === 'BOOKED'),
    JSON.stringify(seats.map((s) => s.status)));

  const people = (
    await admin.supabase.from('booking_passengers').select('seat_id').eq('booking_id', booking.bookingId)
  ).data ?? [];
  check('and each passenger now has a seat', people.every((p) => p.seat_id !== null),
    JSON.stringify(people.map((p) => p.seat_id)));
  check('each a different one', new Set(people.map((p) => p.seat_id)).size === people.length);

  const audit = (
    await admin.supabase
      .from('audit_logs')
      .select('metadata')
      .eq('action', 'COUNTER_PAYMENT_RECORDED')
      .eq('actor_user_id', roro.userId)
  ).data ?? [];
  const mine = audit.filter((a) => a.metadata?.bookingReference === booking.reference);
  check('the cash is audited once, with the method and receipt', mine.length === 1
    && mine[0].metadata?.method === 'CASH' && Boolean(mine[0].metadata?.receiptNumber),
    JSON.stringify(mine.map((a) => a.metadata)));

  // A clerk double-tapping must not take the fare twice.
  const again = await roro.supabase.rpc('record_counter_payment', {
    p_booking_id: booking.bookingId,
    p_method: 'CASH',
  });
  check('taking the cash again is a no-op', again.data?.alreadyPaid === true, JSON.stringify(again.data ?? again.error));
  check('returning the same receipt', again.data?.receiptNumber === paid.data?.receiptNumber,
    `${again.data?.receiptNumber} vs ${paid.data?.receiptNumber}`);

  const payments = (
    await admin.supabase.from('payments').select('id').eq('booking_id', booking.bookingId).eq('status', 'PAID')
  ).data ?? [];
  const receipts = (
    await admin.supabase.from('receipts').select('id').eq('booking_id', booking.bookingId)
  ).data ?? [];
  check('exactly one payment and one receipt exist', payments.length === 1 && receipts.length === 1,
    `${payments.length} payments, ${receipts.length} receipts`);
}

// ---------------------------------------------------------------------------
console.log('\nThe simulated methods still simulate');
// ---------------------------------------------------------------------------
{
  const sim = await sell(roro, await freeSeats(1));
  if (sim.error) {
    check('a second counter booking can be made', false, sim.error.message);
  } else {
    const paid = await roro.supabase.rpc('record_counter_payment', {
      p_booking_id: sim.data.bookingId,
      p_method: 'TEST_GCASH',
    });
    check('a test method is accepted', !paid.error && paid.data?.status === 'CONFIRMED',
      paid.error?.message ?? paid.data?.status);

    const payment = (
      await admin.supabase.from('payments').select('provider, method, received_by')
        .eq('booking_id', sim.data.bookingId).eq('status', 'PAID').single()
    ).data;
    check('it is recorded as the mock provider, not cash', payment?.provider === 'MOCK', payment?.provider);
    check('with the method the clerk chose', payment?.method === 'TEST_GCASH', payment?.method);
    check('and nobody accountable for money, because none moved',
      payment?.received_by === null, String(payment?.received_by));
  }
}

// ---------------------------------------------------------------------------
console.log('\nA passenger with no smartphone, end to end');
// ---------------------------------------------------------------------------
if (booking) {
  // Nobody owns this booking, so the clerk is the one who can print its ticket.
  const passOther = await invoke('get-boarding-pass', { bookingId: booking.bookingId }, passenger.accessToken);
  check('a passenger cannot fetch a counter booking’s pass', passOther.body?.success === false,
    passOther.body?.code);

  const pass = await invoke('get-boarding-pass', { bookingId: booking.bookingId }, roro.accessToken);
  check('the clerk can, which is what gets printed', pass.body?.success === true, pass.body?.code);

  if (pass.body?.success) {
    const d = pass.body.data;
    const payload = JSON.stringify({
      type: d.type,
      bookingId: d.bookingId,
      reference: d.reference,
      token: d.token,
    });

    const opened = await roro.supabase.rpc('set_trip_boarding', { p_trip_id: trip.id });
    check('the operator opens boarding', !opened.error, opened.error?.message);

    const scan = await invoke('validate-qr', { payload, tripId: trip.id }, roro.accessToken);
    check('the printed QR scans as VALID', scan.body?.data?.result === 'VALID',
      scan.body?.data?.result ?? scan.body?.code);
    check('and shows the walk-in by name',
      (scan.body?.data?.passengers ?? []).some((p) => p.name === 'Lola Remedios'),
      JSON.stringify(scan.body?.data?.passengers?.map((p) => p.name)));

    const boarded = await invoke('confirm-boarding', { payload, tripId: trip.id }, roro.accessToken);
    check('the walk-in boards', boarded.body?.data?.boarded === true, JSON.stringify(boarded.body?.data));

    // Scoped to this booking's reference, not the passenger name: the suite
    // sells twice on the same trip and both walk-ins are called Lola.
    const manifest = (
      await roro.supabase
        .from('operator_manifest')
        .select('booking_reference, passenger_name, seat_number, boarded_at')
        .eq('trip_id', trip.id)
    ).data ?? [];
    const lola = manifest.find(
      (m) => m.booking_reference === booking.reference && m.passenger_name === 'Lola Remedios',
    );
    check('the manifest lists them with a seat and a boarding time',
      Boolean(lola?.seat_number && lola?.boarded_at), JSON.stringify(lola));

    // The guard that matters: a booking with no account holder must not break
    // the loyalty award when the trip ends.
    const started = await roro.supabase.rpc('start_trip', { p_trip_id: trip.id });
    check('the trip can depart', !started.error, started.error?.message);

    const ended = await roro.supabase.rpc('end_trip', { p_trip_id: trip.id });
    check('and can be ended with a walk-in aboard', !ended.error, ended.error?.message);
    check('awarding them no points, because they have no account',
      ended.data?.pointsAwarded === 0, JSON.stringify(ended.data));

    const finished = (
      await admin.supabase.from('bookings').select('status').eq('id', booking.bookingId).single()
    ).data;
    check('their booking completed like any other', finished?.status === 'COMPLETED', finished?.status);
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
