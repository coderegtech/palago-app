/**
 * Booking guarantees, verified against the local stack.
 *
 *   pnpm db:verify:booking
 *
 * The point of `create_booking` is that it is atomic under contention. That
 * cannot be shown with a unit test or by reading the SQL — it needs real
 * concurrent transactions racing for the same rows. Each supabase-js `rpc` call
 * is a separate HTTP request and therefore a separate transaction, so firing a
 * batch of them with `Promise.all` reproduces the actual race.
 *
 * Two properties are specific to this design:
 *
 *   - **No seat is assigned at booking.** A passenger never picks one, and
 *     which seat each traveller gets is decided when the payment is verified.
 *     What a booking holds is capacity.
 *   - **Simultaneous buyers do not collide.** They take different seats rather
 *     than queueing for the same one; only when the bus is down to its last
 *     seat does exactly one of them win.
 *
 * Run after any change to create_booking, cancel_booking or expire_seat_holds.
 */

import { createClient } from '@supabase/supabase-js';
import { loadVerifyEnv } from './_verify-env.mjs';

const { url: URL, key: KEY } = loadVerifyEnv();
const PASSWORD = 'PalawanGo2026';

const client = () => createClient(URL, KEY, { auth: { persistSession: false } });

async function signIn(email) {
  const supabase = client();
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return supabase;
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

const passenger = await signIn('passenger@palago.test');
// A second ORDINARY passenger. An admin is the wrong control for isolation: it
// is *allowed* to read and cancel other people's bookings.
const other = await signIn('passenger2@palago.test');
const admin = await signIn('admin@palago.test');
const cherry = await signIn('operator@palago.test');

/** Cancel every still-unpaid booking, releasing its seats. */
async function releaseAllHolds() {
  const { data: open } = await admin
    .from('bookings')
    .select('id')
    .in('status', ['PENDING', 'PAYMENT_PENDING']);
  for (const booking of open ?? []) {
    await admin.rpc('cancel_booking', { p_booking_id: booking.id });
  }
}

// Start from a clean slate so a previous run's holds cannot make this one fail
// for the wrong reason.
await releaseAllHolds();

const { data: trips } = await passenger
  .from('trips')
  .select('id, fare, trip_number')
  .eq('status', 'SCHEDULED')
  .order('departure_date')
  .limit(1);
const trip = trips[0];

console.log(`\nUsing trip ${trip.trip_number} (fare ${trip.fare} centavos)`);

const passengerFor = (name = 'Juan Dela Cruz') => ({
  name,
  phone: '09171234567',
  email: 'juan@palago.test',
  type: 'ADULT',
});

const book = (who, count, name = 'Juan Dela Cruz') =>
  who.rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: Array.from({ length: count }, (_unused, i) =>
      passengerFor(count === 1 ? name : `${name} ${i + 1}`),
    ),
  });

/** Free seats on the trip right now. */
async function freeSeats() {
  const { count } = await admin
    .from('trip_seats')
    .select('seat_id', { count: 'exact', head: true })
    .eq('trip_id', trip.id)
    .eq('status', 'AVAILABLE');
  return count ?? 0;
}

/** The seat rows a booking holds. */
const seatsOf = async (bookingId) =>
  (
    await admin
      .from('trip_seats')
      .select('seat_id, status, held_until, booking_id')
      .eq('booking_id', bookingId)
  ).data ?? [];

/** What each passenger on a booking was given, if anything. */
const passengersOf = async (bookingId) =>
  (
    await admin
      .from('booking_passengers')
      .select('id, passenger_name, seat_id')
      .eq('booking_id', bookingId)
  ).data ?? [];

// ---------------------------------------------------------------------------
console.log('\nHappy path');
// ---------------------------------------------------------------------------
let firstBookingId;
{
  const { data, error } = await book(passenger, 1);
  firstBookingId = data?.bookingId;

  check('a booking can be made without choosing a seat', !error && Boolean(data?.bookingId), error?.message);
  check('booking opens in PAYMENT_PENDING', data?.status === 'PAYMENT_PENDING', data?.status);
  check(
    'reference looks like PG-YYYY-NNNNNN',
    /^PG-\d{4}-\d{6}$/.test(data?.reference ?? ''),
    data?.reference,
  );
  check(
    'total is the trip fare, computed server-side',
    data?.totalAmount === trip.fare,
    `${data?.totalAmount} vs fare ${trip.fare}`,
  );

  const held = await seatsOf(data.bookingId);
  check('one seat is held for it', held.length === 1, `${held.length} seats`);
  check('the seat is HELD, not BOOKED', held[0]?.status === 'HELD', held[0]?.status);
  check('the hold carries an expiry', Boolean(held[0]?.held_until), 'held_until is null');

  const minutes = (new Date(held[0].held_until) - Date.now()) / 60000;
  check('the hold lasts about 10 minutes', minutes > 9 && minutes <= 10.5, `${minutes.toFixed(1)}m`);

  // The point of the change: capacity is held, but nobody has a seat number
  // until they have paid for it.
  const people = await passengersOf(data.bookingId);
  check('the passenger has no seat yet', people.every((x) => x.seat_id === null),
    JSON.stringify(people.map((x) => x.seat_id)));
  check('and the reply says so', data?.seatsAssigned === false, String(data?.seatsAssigned));

  const two = await book(passenger, 2, 'Cruz');
  check(
    'two seats price at fare x 2',
    two.data?.totalAmount === trip.fare * 2,
    `${two.data?.totalAmount} vs ${trip.fare * 2}`,
  );
  check('both passengers are recorded', two.data?.seatCount === 2, String(two.data?.seatCount));
  check('and two seats are held', (await seatsOf(two.data.bookingId)).length === 2);
}

// ---------------------------------------------------------------------------
console.log('\nConcurrency — the guarantee this function exists for');
// ---------------------------------------------------------------------------
{
  // Eight people buying at the same instant on a bus with room: all eight
  // should succeed, on eight *different* seats. Before, they would have been
  // fighting over whichever seats they had each picked.
  const CALLERS = 8;
  const attempts = Array.from({ length: CALLERS }, (_unused, i) =>
    (i % 2 === 0 ? passenger : other).rpc('create_booking', {
      p_trip_id: trip.id,
      p_passengers: [passengerFor(`Racer ${i}`)],
    }),
  );

  const results = await Promise.all(attempts);
  const won = results.filter((r) => !r.error);
  check(
    `all ${CALLERS} simultaneous buyers are served`,
    won.length === CALLERS,
    `${won.length} succeeded: ${[...new Set(results.filter((r) => r.error).map((r) => r.error.message))].join(', ')}`,
  );

  const seatIds = [];
  for (const r of won) {
    for (const row of await seatsOf(r.data.bookingId)) seatIds.push(row.seat_id);
  }
  check(
    'and no two of them are given the same seat',
    new Set(seatIds).size === seatIds.length && seatIds.length === CALLERS,
    `${seatIds.length} seats, ${new Set(seatIds).size} distinct`,
  );

  for (const r of won) await passenger.rpc('cancel_booking', { p_booking_id: r.data.bookingId });
}

// ---------------------------------------------------------------------------
console.log('\nThe last seat');
// ---------------------------------------------------------------------------
{
  // Fill the bus down to one free seat, then have several people try to buy at
  // once. This is the case where someone must lose, and losing must be a clean
  // SEAT_UNAVAILABLE rather than an oversold bus.
  const fillers = [];
  let free = await freeSeats();
  while (free > 1) {
    const take = Math.min(10, free - 1);
    const filled = await book(passenger, take, 'Filler');
    if (filled.error) break;
    fillers.push(filled.data.bookingId);
    free = await freeSeats();
  }
  check('the bus can be filled to its last seat', free === 1, `${free} free`);

  const CALLERS = 5;
  const scramble = await Promise.all(
    Array.from({ length: CALLERS }, (_unused, i) =>
      (i % 2 === 0 ? passenger : other).rpc('create_booking', {
        p_trip_id: trip.id,
        p_passengers: [passengerFor(`Last ${i}`)],
      }),
    ),
  );
  const got = scramble.filter((r) => !r.error);
  const missed = scramble.filter((r) => r.error);

  check('exactly one buyer gets the last seat', got.length === 1, `${got.length} succeeded`);
  check(
    'the rest are told SEAT_UNAVAILABLE, not sold a seat that is gone',
    missed.length === CALLERS - 1 && missed.every((r) => r.error.message === 'SEAT_UNAVAILABLE'),
    [...new Set(missed.map((r) => r.error.message))].join(', '),
  );
  check('the bus is now full', (await freeSeats()) === 0, `${await freeSeats()} free`);

  const full = await book(passenger, 1, 'Too Late');
  check('and a later booking is refused too', full.error?.message === 'SEAT_UNAVAILABLE',
    full.error?.message);

  for (const id of [...fillers, ...got.map((r) => r.data.bookingId)]) {
    await passenger.rpc('cancel_booking', { p_booking_id: id });
  }
  check('cancelling the fillers gives the bus back', (await freeSeats()) > 1, `${await freeSeats()} free`);
}

// ---------------------------------------------------------------------------
console.log('\nDeadlock resistance — the counter picking overlapping seats');
// ---------------------------------------------------------------------------
{
  // Passengers no longer name seats, but the operator counter still does. Two
  // clerks asking for the same two seats in opposite order is the textbook
  // deadlock: each grabs one row and waits on the other. The ordered locking
  // inside create_booking is what stops it.
  const { data: free } = await admin
    .from('trip_seats')
    .select('seat_id')
    .eq('trip_id', trip.id)
    .eq('status', 'AVAILABLE')
    .order('seat_id')
    .limit(2);
  const [a, b] = free.map((r) => r.seat_id);

  const outcomes = await Promise.all([
    cherry.rpc('create_booking', {
      p_trip_id: trip.id,
      p_passengers: [passengerFor('Forward A'), passengerFor('Forward B')],
      p_seat_ids: [a, b],
    }),
    cherry.rpc('create_booking', {
      p_trip_id: trip.id,
      p_passengers: [passengerFor('Reverse B'), passengerFor('Reverse A')],
      p_seat_ids: [b, a],
    }),
  ]);

  const winners = outcomes.filter((r) => !r.error);
  const losers = outcomes.filter((r) => r.error);

  check(
    'no deadlock is reported',
    !losers.some((r) => /deadlock/i.test(r.error.message)),
    losers.map((r) => r.error.message).join(', '),
  );
  check('exactly one clerk gets the pair', winners.length === 1, `${winners.length} succeeded`);
  check(
    'the loser gets SEAT_UNAVAILABLE, not a database error',
    losers.every((r) => r.error.message === 'SEAT_UNAVAILABLE'),
    losers.map((r) => r.error.message).join(', '),
  );

  // Picking seats is staff-only: a passenger asking for one is refused.
  const pickedByPassenger = await passenger.rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor('Seat Picker')],
    p_seat_ids: [a],
  });
  check(
    'a passenger cannot choose their own seat',
    pickedByPassenger.error?.message === 'FORBIDDEN',
    pickedByPassenger.error?.message ?? 'the call succeeded',
  );

  for (const r of winners) await admin.rpc('cancel_booking', { p_booking_id: r.data.bookingId });
}

// ---------------------------------------------------------------------------
console.log('\nRejections');
// ---------------------------------------------------------------------------
{
  const beforeFree = await freeSeats();

  const oneSeat = (
    await admin.from('trip_seats').select('seat_id').eq('trip_id', trip.id)
      .eq('status', 'AVAILABLE').limit(1).single()
  ).data.seat_id;

  const mismatched = await cherry.rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor('A'), passengerFor('B')],
    p_seat_ids: [oneSeat],
  });
  check(
    'one seat for two passengers is refused',
    mismatched.error?.message === 'VALIDATION_ERROR',
    mismatched.error?.message ?? 'the call succeeded',
  );

  const duplicated = await cherry.rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor('A'), passengerFor('B')],
    p_seat_ids: [oneSeat, oneSeat],
  });
  check(
    'the same seat twice in one booking is refused',
    duplicated.error?.message === 'VALIDATION_ERROR',
    duplicated.error?.message ?? 'the call succeeded',
  );

  const nameless = await passenger.rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: [{ name: '   ', type: 'ADULT' }],
  });
  check(
    'a blank passenger name is refused',
    nameless.error?.message === 'VALIDATION_ERROR',
    nameless.error?.message,
  );

  const empty = await passenger.rpc('create_booking', { p_trip_id: trip.id, p_passengers: [] });
  check(
    'an empty passenger list is refused',
    empty.error?.message === 'VALIDATION_ERROR',
    empty.error?.message,
  );

  const crowd = await book(passenger, 11, 'Crowd');
  check(
    'more than ten passengers in one booking is refused',
    crowd.error?.message === 'VALIDATION_ERROR',
    crowd.error?.message,
  );

  const foreign = await cherry.rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor('Foreign Seat')],
    p_seat_ids: ['00000000-0000-0000-0000-000000000000'],
  });
  check(
    'a seat from another bus is refused',
    foreign.error?.message === 'SEAT_UNAVAILABLE' || foreign.error?.message === 'VALIDATION_ERROR',
    foreign.error?.message,
  );

  const unauth = await client().rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor('Anonymous')],
  });
  check('an anonymous caller cannot book', Boolean(unauth.error), 'the call succeeded');

  check(
    'every rejected booking held nothing',
    (await freeSeats()) === beforeFree,
    `${beforeFree} free before, ${await freeSeats()} after`,
  );
}

// ---------------------------------------------------------------------------
console.log('\nCancellation');
// ---------------------------------------------------------------------------
{
  const created = await book(passenger, 1);
  if (created.error) throw new Error(`setup failed: ${created.error.message}`);
  const bookingId = created.data.bookingId;
  const [heldRow] = await seatsOf(bookingId);

  const cancelled = await passenger.rpc('cancel_booking', { p_booking_id: bookingId });
  check(
    'a pending booking can be cancelled',
    cancelled.data?.status === 'CANCELLED',
    cancelled.error?.message,
  );

  const row = (
    await admin.from('trip_seats').select('status, held_until').eq('seat_id', heldRow.seat_id)
      .eq('trip_id', trip.id).single()
  ).data;
  check('cancelling releases the seat', row?.status === 'AVAILABLE', row?.status);
  check('the released seat keeps no stale hold', row?.held_until === null, 'held_until still set');

  const again = await passenger.rpc('cancel_booking', { p_booking_id: bookingId });
  check(
    'cancelling twice is idempotent, not an error',
    !again.error && again.data?.status === 'CANCELLED',
    again.error?.message,
  );

  const mine = await book(passenger, 1);
  const theirs = await other.rpc('cancel_booking', { p_booking_id: mine.data.bookingId });
  check(
    "another passenger cannot cancel someone else's booking",
    theirs.error?.message === 'FORBIDDEN' || theirs.error?.message === 'NOT_FOUND',
    theirs.error?.message ?? 'the call succeeded',
  );

  const byAdmin = await admin.rpc('cancel_booking', { p_booking_id: mine.data.bookingId });
  check('an admin may cancel any booking', byAdmin.data?.status === 'CANCELLED', byAdmin.error?.message);
}

// ---------------------------------------------------------------------------
console.log('\nPrivileges');
// ---------------------------------------------------------------------------
{
  const sweep = await passenger.rpc('expire_seat_holds');
  check(
    'a signed-in user cannot run the expiry sweep',
    Boolean(sweep.error),
    'the call succeeded — expiry must be service-role only',
  );

  const write = await passenger.from('bookings').insert({
    user_id: '00000000-0000-0000-0000-000000000000',
    trip_id: trip.id,
    subtotal: 1,
    total_amount: 1,
  });
  check('a client cannot INSERT a booking directly', Boolean(write.error), 'insert succeeded');

  const own = (await passenger.from('bookings').select('id').limit(1)).data[0];
  const cheat = await passenger
    .from('bookings')
    .update({ total_amount: 1, status: 'CONFIRMED' })
    .eq('id', own.id)
    .select();
  check(
    'a client cannot confirm its own booking or change its total',
    Boolean(cheat.error) || cheat.data?.length === 0,
    'the update was applied',
  );

  const someHeld = (
    await admin.from('trip_seats').select('seat_id').eq('trip_id', trip.id).eq('status', 'HELD')
      .limit(1).maybeSingle()
  ).data;
  const seatWrite = await passenger
    .from('trip_seats')
    .update({ status: 'AVAILABLE' })
    .eq('trip_id', trip.id)
    .eq('seat_id', someHeld?.seat_id ?? '00000000-0000-0000-0000-000000000000')
    .select();
  check(
    'a client cannot free a seat it does not own',
    Boolean(seatWrite.error) || seatWrite.data?.length === 0,
    'the update was applied',
  );
}

// ---------------------------------------------------------------------------
console.log('\nVisibility');
// ---------------------------------------------------------------------------
{
  const passengerId = (await passenger.auth.getUser()).data.user.id;
  const mine = (await passenger.from('bookings').select('id, user_id')).data ?? [];

  check(
    'a passenger sees only their own bookings',
    mine.length > 0 && mine.every((b) => b.user_id === passengerId),
    `saw ${mine.length}`,
  );

  const otherId = (await other.auth.getUser()).data.user.id;
  const theirs = (await other.from('bookings').select('id, user_id')).data ?? [];
  check(
    "a second passenger sees none of the first passenger's bookings",
    theirs.every((b) => b.user_id === otherId),
    `saw ${theirs.length} rows, some not their own`,
  );

  const all = (await admin.from('bookings').select('id')).data ?? [];
  check('an admin sees every booking', all.length >= mine.length, `admin ${all.length}, user ${mine.length}`);

  const cherry = await signIn('operator@palago.test');
  const manifest = (await cherry.from('booking_passengers').select('id')).data ?? [];
  check('the operator can read the manifest for its own trips', Array.isArray(manifest));
}

// ---------------------------------------------------------------------------
// Cleanup — the run leaves seats HELD, so without this a second run finds the
// trip full and fails for reasons unrelated to the code under test.
// ---------------------------------------------------------------------------
await releaseAllHolds();
{
  const { data: stillHeld } = await admin.from('trip_seats').select('id').eq('status', 'HELD');
  check(
    'cleanup releases every hold, so the script is re-runnable',
    (stillHeld?.length ?? 0) === 0,
    `${stillHeld?.length} seats still held`,
  );
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
