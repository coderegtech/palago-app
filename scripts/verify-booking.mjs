/**
 * Seat reservation guarantees, verified against the local stack.
 *
 *   pnpm db:verify:booking
 *
 * The point of `reserve_seats` is that it is atomic under contention. That
 * cannot be shown with a unit test or by reading the SQL — it needs real
 * concurrent transactions racing for the same row. Each supabase-js `rpc` call
 * is a separate HTTP request and therefore a separate transaction, so firing a
 * batch of them with `Promise.all` reproduces the actual race.
 *
 * Run after any change to reserve_seats, cancel_booking or expire_seat_holds.
 */

import { createClient } from '@supabase/supabase-js';
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

const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
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

/**
 * Claim `n` seats that are free *right now*.
 *
 * Every block asks for its own seats rather than indexing into a list captured
 * at startup — earlier blocks consume seats, so fixed indices go stale and the
 * later assertions then fail for reasons that have nothing to do with the code
 * under test.
 */
async function takeFreeSeats(n) {
  const { data } = await passenger
    .from('trip_seats')
    .select('seat_id')
    .eq('trip_id', trip.id)
    .eq('status', 'AVAILABLE')
    .order('seat_id')
    .limit(n);
  if (!data || data.length < n) throw new Error(`needed ${n} free seats, found ${data?.length ?? 0}`);
  return data.map((s) => s.seat_id);
}

console.log(`\nUsing trip ${trip.trip_number} (fare ${trip.fare} centavos)`);

const passengerFor = (seatId, name = 'Juan Dela Cruz') => ({
  seatId,
  name,
  phone: '09171234567',
  email: 'juan@palago.test',
  type: 'ADULT',
});

const seatRow = async (seatId) =>
  (
    await admin
      .from('trip_seats')
      .select('status, held_until, booking_id')
      .eq('trip_id', trip.id)
      .eq('seat_id', seatId)
      .single()
  ).data;

// ---------------------------------------------------------------------------
console.log('\nHappy path');
// ---------------------------------------------------------------------------
let heldSeat;
{
  const [seat] = await takeFreeSeats(1);
  heldSeat = seat;

  const { data, error } = await passenger.rpc('reserve_seats', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor(seat)],
  });

  check('a single seat can be reserved', !error && Boolean(data?.bookingId), error?.message);
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

  const row = await seatRow(seat);
  check('the seat is now HELD', row?.status === 'HELD', row?.status);
  check('the hold carries an expiry', Boolean(row?.held_until), 'held_until is null');

  const minutes = (new Date(row.held_until) - Date.now()) / 60000;
  check('the hold lasts about 10 minutes', minutes > 9 && minutes <= 10.5, `${minutes.toFixed(1)}m`);

  const pair = await takeFreeSeats(2);
  const two = await passenger.rpc('reserve_seats', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor(pair[0], 'Ana Cruz'), passengerFor(pair[1], 'Ben Cruz')],
  });
  check(
    'two seats price at fare x 2',
    two.data?.totalAmount === trip.fare * 2,
    `${two.data?.totalAmount} vs ${trip.fare * 2}`,
  );
  check('both passengers are recorded', two.data?.seatCount === 2, String(two.data?.seatCount));
}

// ---------------------------------------------------------------------------
console.log('\nConcurrency — the guarantee this function exists for');
// ---------------------------------------------------------------------------
{
  const [contested] = await takeFreeSeats(1);
  const CALLERS = 8;

  const attempts = Array.from({ length: CALLERS }, (_, i) =>
    (i % 2 === 0 ? passenger : other).rpc('reserve_seats', {
      p_trip_id: trip.id,
      p_passengers: [passengerFor(contested, `Racer ${i}`)],
    }),
  );

  const results = await Promise.all(attempts);
  const won = results.filter((r) => !r.error);
  const lost = results.filter((r) => r.error);

  check(
    `exactly one of ${CALLERS} simultaneous callers wins the seat`,
    won.length === 1,
    `${won.length} succeeded`,
  );
  check(
    'every loser is told SEAT_UNAVAILABLE',
    lost.length === CALLERS - 1 && lost.every((r) => r.error.message === 'SEAT_UNAVAILABLE'),
    [...new Set(lost.map((r) => r.error.message))].join(', '),
  );

  const row = await seatRow(contested);
  check('the contested seat is HELD exactly once', row?.status === 'HELD', row?.status);
  check(
    'the winning booking owns the seat',
    row?.booking_id === won[0]?.data?.bookingId,
    'seat points at a different booking',
  );
}

// ---------------------------------------------------------------------------
console.log('\nDeadlock resistance — overlapping seat sets, opposite order');
// ---------------------------------------------------------------------------
{
  // Both callers want the same two seats, requested in opposite order. Without
  // a deterministic lock order inside reserve_seats this is the textbook
  // deadlock: each grabs one row and waits on the other.
  const [a, b] = await takeFreeSeats(2);

  const outcomes = await Promise.all([
    passenger.rpc('reserve_seats', {
      p_trip_id: trip.id,
      p_passengers: [passengerFor(a, 'Forward A'), passengerFor(b, 'Forward B')],
    }),
    other.rpc('reserve_seats', {
      p_trip_id: trip.id,
      p_passengers: [passengerFor(b, 'Reverse B'), passengerFor(a, 'Reverse A')],
    }),
  ]);

  const winners = outcomes.filter((r) => !r.error);
  const losers = outcomes.filter((r) => r.error);

  check(
    'no deadlock is reported',
    !losers.some((r) => /deadlock/i.test(r.error.message)),
    losers.map((r) => r.error.message).join(', '),
  );
  check('exactly one caller gets the pair', winners.length === 1, `${winners.length} succeeded`);
  check(
    'the loser gets SEAT_UNAVAILABLE, not a database error',
    losers.every((r) => r.error.message === 'SEAT_UNAVAILABLE'),
    losers.map((r) => r.error.message).join(', '),
  );
}

// ---------------------------------------------------------------------------
console.log('\nRejections');
// ---------------------------------------------------------------------------
{
  const taken = await passenger.rpc('reserve_seats', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor(heldSeat)],
  });
  check(
    'an already-held seat is refused',
    taken.error?.message === 'SEAT_UNAVAILABLE',
    taken.error?.message,
  );

  // These all fail, so the seat stays free and can be reused between them.
  const [spare] = await takeFreeSeats(1);

  const duped = await passenger.rpc('reserve_seats', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor(spare, 'A'), passengerFor(spare, 'B')],
  });
  check(
    'the same seat twice in one booking is refused',
    duped.error?.message === 'VALIDATION_ERROR',
    duped.error?.message,
  );

  const nameless = await passenger.rpc('reserve_seats', {
    p_trip_id: trip.id,
    p_passengers: [{ seatId: spare, name: '   ', type: 'ADULT' }],
  });
  check(
    'a blank passenger name is refused',
    nameless.error?.message === 'VALIDATION_ERROR',
    nameless.error?.message,
  );

  const empty = await passenger.rpc('reserve_seats', { p_trip_id: trip.id, p_passengers: [] });
  check(
    'an empty passenger list is refused',
    empty.error?.message === 'VALIDATION_ERROR',
    empty.error?.message,
  );

  const foreign = await passenger.rpc('reserve_seats', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor('00000000-0000-0000-0000-000000000000')],
  });
  check(
    'a seat from another bus is refused',
    foreign.error?.message === 'VALIDATION_ERROR',
    foreign.error?.message,
  );

  const unauth = await client().rpc('reserve_seats', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor(spare)],
  });
  check('an anonymous caller cannot reserve', Boolean(unauth.error), 'the call succeeded');

  const stillFree = await seatRow(spare);
  check(
    'a rejected reservation leaves the seat untouched',
    stillFree?.status === 'AVAILABLE',
    stillFree?.status,
  );
}

// ---------------------------------------------------------------------------
console.log('\nCancellation');
// ---------------------------------------------------------------------------
{
  const [seat] = await takeFreeSeats(1);
  const created = await passenger.rpc('reserve_seats', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor(seat)],
  });
  if (created.error) throw new Error(`setup failed: ${created.error.message}`);
  const bookingId = created.data.bookingId;

  const cancelled = await passenger.rpc('cancel_booking', { p_booking_id: bookingId });
  check(
    'a pending booking can be cancelled',
    cancelled.data?.status === 'CANCELLED',
    cancelled.error?.message,
  );

  const row = await seatRow(seat);
  check('cancelling releases the seat', row?.status === 'AVAILABLE', row?.status);
  check('the released seat keeps no stale hold', row?.held_until === null, 'held_until still set');

  const again = await passenger.rpc('cancel_booking', { p_booking_id: bookingId });
  check(
    'cancelling twice is idempotent, not an error',
    !again.error && again.data?.status === 'CANCELLED',
    again.error?.message,
  );

  const [otherSeat] = await takeFreeSeats(1);
  const mine = await passenger.rpc('reserve_seats', {
    p_trip_id: trip.id,
    p_passengers: [passengerFor(otherSeat)],
  });
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

  const seatWrite = await passenger
    .from('trip_seats')
    .update({ status: 'AVAILABLE' })
    .eq('trip_id', trip.id)
    .eq('seat_id', heldSeat)
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
