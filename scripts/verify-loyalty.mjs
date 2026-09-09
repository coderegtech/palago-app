/**
 * Loyalty — verified against the local stack with real signed-in roles.
 *
 *   pnpm db:verify:loyalty
 *
 * What this exists to prove, none of which a unit test can show:
 *
 *   - points are earned for a trip TAKEN, not for one booked or merely paid for
 *   - earning is exactly-once: ending the same trip twice awards once, and so
 *     does ending it from two places at the same moment
 *   - nobody can write a points balance or a ledger row directly
 *   - a redemption reduces the booking total server-side; the client names a
 *     reward, never an amount
 *   - a discount can never exceed the fare, so a booking cannot go negative
 *   - points staked on a booking come back if it is cancelled or refunded
 *   - one booking cannot stack two rewards
 *   - the balance always equals the sum of the ledger
 *
 * Requires `supabase start`.
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

const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
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

async function invoke(fn, body, accessToken) {
  const res = await fetch(`${URL_}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: KEY,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const passenger = await signIn('passenger@palago.test');
const other = await signIn('passenger2@palago.test');
const driver = await signIn('driver@palago.test');

async function points(session) {
  const { data } = await session.supabase
    .from('loyalty_accounts')
    .select('points_balance, lifetime_points')
    .single();
  return data;
}

async function ledgerSum(session) {
  const { data } = await session.supabase.from('loyalty_transactions').select('points');
  return (data ?? []).reduce((total, row) => total + row.points, 0);
}

/** Book seats, pay by wallet, and board every passenger on the trip. */
async function bookAndBoard(session, tripId, count = 1) {
  const { data: seats } = await session.supabase
    .from('trip_seats')
    .select('seat_id')
    .eq('trip_id', tripId)
    .eq('status', 'AVAILABLE')
    .limit(count);

  const { data: booking, error } = await session.supabase.rpc('reserve_seats', {
    p_trip_id: tripId,
    p_passengers: seats.map((s, i) => ({
      seatId: s.seat_id,
      name: `Loyalty ${i + 1}`,
      phone: '09171234567',
      email: null,
      type: 'ADULT',
    })),
  });
  if (error) throw new Error(`reserve: ${error.message}`);
  return booking;
}

/**
 * Book, pay, board and complete a whole trip, returning the points earned.
 *
 * The suite needs a real balance before it can test redeeming, and the ONLY way
 * to get points is to travel — which is the point of the design. A ₱450 trip
 * earns 45, and the cheapest reward is 50, so more than one trip is required.
 * That is worth noticing rather than working around: a scheme where the first
 * trip already buys a reward would be a different scheme.
 */
async function completeTripCycle(session, tripId) {
  const booking = await bookAndBoard(session, tripId, 1);
  await payByQr(session, booking.bookingId);
  await driver.supabase.rpc('start_trip', { p_trip_id: tripId });

  const pass = await invoke('get-boarding-pass', { bookingId: booking.bookingId }, session.accessToken);
  await invoke(
    'confirm-boarding',
    {
      payload: JSON.stringify({
        type: 'PALAGO_BOOKING',
        bookingId: pass.body.data.bookingId,
        reference: pass.body.data.reference,
        token: pass.body.data.token,
      }),
    },
    driver.accessToken,
  );

  const ended = await driver.supabase.rpc('end_trip', { p_trip_id: tripId });
  return { booking, pointsAwarded: ended.data?.pointsAwarded ?? 0 };
}

/** Travel until the balance can afford the dearest reward we want to test. */
async function earnAtLeast(session, target) {
  const { data: trips } = await driver.supabase
    .from('driver_assignments')
    .select('trip_id')
    .eq('trip_status', 'SCHEDULED');

  for (const t of trips ?? []) {
    if ((await points(session)).points_balance >= target) break;
    await completeTripCycle(session, t.trip_id);
  }
  return (await points(session)).points_balance;
}

async function payByQr(session, bookingId) {
  const created = await invoke('create-test-payment', { bookingId }, session.accessToken);
  const token = new URL(created.body.data.paymentUrl).searchParams.get('t');
  await invoke('confirm-test-payment', { reference: created.body.data.reference, token });
}

// ---------------------------------------------------------------------------
console.log('\nEvery user starts with an empty account');
// ---------------------------------------------------------------------------

const start = await points(passenger);
check('a passenger has a loyalty account', start !== null, JSON.stringify(start));
check('with no points', start?.points_balance === 0, String(start?.points_balance));
check('and no lifetime points', start?.lifetime_points === 0, String(start?.lifetime_points));

// ---------------------------------------------------------------------------
console.log('\nNobody writes points directly');
// ---------------------------------------------------------------------------

const directAward = await passenger.supabase
  .from('loyalty_accounts')
  .update({ points_balance: 99999 })
  .eq('user_id', passenger.userId)
  .select();
check(
  'a user cannot set their own points balance',
  Boolean(directAward.error) || directAward.data?.length === 0,
  'the update applied',
);

const directLedger = await passenger.supabase.from('loyalty_transactions').insert({
  user_id: passenger.userId,
  type: 'EARNED',
  points: 500,
  balance_before: 0,
  balance_after: 500,
});
check('and cannot write a ledger row', Boolean(directLedger.error), 'the insert succeeded');

const editReward = await passenger.supabase
  .from('rewards')
  .update({ points_required: 1 })
  .eq('code', 'FIFTY_OFF')
  .select();
check(
  'and cannot make a reward cheaper',
  Boolean(editReward.error) || editReward.data?.length === 0,
  'the update applied',
);

const anonPoints = (await client().from('loyalty_accounts').select('id')).data ?? [];
check('an anonymous caller sees no accounts', anonPoints.length === 0, `saw ${anonPoints.length}`);

// ---------------------------------------------------------------------------
console.log('\nPaying is not travelling');
// ---------------------------------------------------------------------------

const trip = (
  await driver.supabase
    .from('driver_assignments')
    .select('trip_id')
    .eq('trip_status', 'SCHEDULED')
    .limit(1)
).data?.[0];

if (!trip) {
  check('a SCHEDULED Cherry trip exists (seed data)', false, 'none found');
} else {
  const tripId = trip.trip_id;

  const booking = await bookAndBoard(passenger, tripId, 1);
  await payByQr(passenger, booking.bookingId);

  const afterPaying = await points(passenger);
  check(
    'paying for a booking earns NOTHING',
    afterPaying.points_balance === 0,
    String(afterPaying.points_balance),
  );

  // -------------------------------------------------------------------------
  console.log('\nCompleting the trip earns points');
  // -------------------------------------------------------------------------

  await driver.supabase.rpc('start_trip', { p_trip_id: tripId });

  const boardingPass = await invoke(
    'get-boarding-pass',
    { bookingId: booking.bookingId },
    passenger.accessToken,
  );
  await invoke(
    'confirm-boarding',
    {
      payload: JSON.stringify({
        type: 'PALAGO_BOOKING',
        bookingId: boardingPass.body.data.bookingId,
        reference: boardingPass.body.data.reference,
        token: boardingPass.body.data.token,
      }),
    },
    driver.accessToken,
  );

  const beforeEnd = await points(passenger);
  check(
    'boarding alone still earns nothing',
    beforeEnd.points_balance === 0,
    String(beforeEnd.points_balance),
  );

  const ended = await driver.supabase.rpc('end_trip', { p_trip_id: tripId });
  check('the driver can end the trip', !ended.error, ended.error?.message);

  const expected = Math.floor(booking.totalAmount / 1000);
  const afterEnd = await points(passenger);
  check(
    `the passenger earned ${expected} points (1 per ₱10 of ₱${(booking.totalAmount / 100).toFixed(2)})`,
    afterEnd.points_balance === expected,
    `${afterEnd.points_balance}, expected ${expected}`,
  );
  check(
    'and lifetime points match',
    afterEnd.lifetime_points === expected,
    String(afterEnd.lifetime_points),
  );
  check(
    'end_trip reports what it awarded',
    ended.data?.pointsAwarded === expected,
    JSON.stringify(ended.data?.pointsAwarded),
  );
  check(
    'the balance equals the ledger sum',
    afterEnd.points_balance === (await ledgerSum(passenger)),
    `balance ${afterEnd.points_balance}, ledger ${await ledgerSum(passenger)}`,
  );

  // -------------------------------------------------------------------------
  console.log('\nEarning is exactly-once');
  // -------------------------------------------------------------------------

  const endedAgain = await driver.supabase.rpc('end_trip', { p_trip_id: tripId });
  check(
    'ending the trip again awards nothing',
    endedAgain.data?.pointsAwarded === 0,
    JSON.stringify(endedAgain.data),
  );
  const afterSecondEnd = await points(passenger);
  check(
    'and the balance is unchanged',
    afterSecondEnd.points_balance === expected,
    `${expected} -> ${afterSecondEnd.points_balance}`,
  );

  // Six simultaneous callers, the way two crew phones would race.
  const races = await Promise.all(
    Array.from({ length: 6 }, () => driver.supabase.rpc('end_trip', { p_trip_id: tripId })),
  );
  const raceAwarded = races.reduce((total, r) => total + (r.data?.pointsAwarded ?? 0), 0);
  const afterRace = await points(passenger);
  check(
    'six simultaneous end_trip calls award nothing extra',
    raceAwarded === 0,
    `awarded ${raceAwarded}`,
  );
  check(
    'and the balance is still exactly one award',
    afterRace.points_balance === expected,
    `${afterRace.points_balance}, expected ${expected}`,
  );

  const earnRows =
    (await passenger.supabase
      .from('loyalty_transactions')
      .select('id')
      .eq('booking_id', booking.bookingId)
      .eq('type', 'EARNED')).data ?? [];
  check('exactly one EARNED row exists for the booking', earnRows.length === 1, `${earnRows.length}`);
}

// ---------------------------------------------------------------------------
console.log('\nThe rewards catalogue');
// ---------------------------------------------------------------------------

const rewards = (await passenger.supabase.from('rewards').select('code, points_required, discount_type').order('points_required')).data ?? [];
check('a signed-in user can read the catalogue', rewards.length > 0, `${rewards.length}`);
check(
  'and no PERK rewards are offered',
  rewards.every((r) => r.discount_type !== 'PERK'),
  rewards.filter((r) => r.discount_type === 'PERK').map((r) => r.code).join(', '),
);

// ---------------------------------------------------------------------------
console.log('\nRedeeming a reward');
// ---------------------------------------------------------------------------

// Travel enough to afford the dearest reward under test (250 points).
const earnedTotal = await earnAtLeast(passenger, 260);
check(
  'travelling several trips builds a usable balance',
  earnedTotal >= 260,
  `${earnedTotal} points after completing trips`,
);

const bookableTrip = (
  await passenger.supabase.from('trip_search').select('id, fare').eq('status', 'SCHEDULED').limit(1)
).data?.[0];

if (!bookableTrip) {
  check('a bookable trip exists', false, 'none found');
} else {
  const balanceNow = (await points(passenger)).points_balance;
  const fifty = (
    await passenger.supabase.from('rewards').select('id, points_required, discount_value').eq('code', 'FIFTY_OFF').single()
  ).data;

  const b = await bookAndBoard(passenger, bookableTrip.id, 1);

  // Not yours to redeem against.
  const foreign = await other.supabase.rpc('redeem_reward', {
    p_booking_id: b.bookingId,
    p_reward_id: fifty.id,
  });
  check(
    "another user cannot redeem against someone else's booking",
    Boolean(foreign.error),
    'it succeeded',
  );

  const redeemed = await passenger.supabase.rpc('redeem_reward', {
    p_booking_id: b.bookingId,
    p_reward_id: fifty.id,
  });
  check('the owner can redeem a reward they can afford', !redeemed.error, redeemed.error?.message);
  check(
    'the discount is the reward value, computed server-side',
    redeemed.data?.discount === fifty.discount_value,
    JSON.stringify(redeemed.data),
  );

  const bookingRow = (
    await passenger.supabase
      .from('bookings')
      .select('subtotal, loyalty_discount, total_amount')
      .eq('id', b.bookingId)
      .single()
  ).data;
  check(
    'the booking total actually dropped',
    bookingRow.total_amount === bookingRow.subtotal - bookingRow.loyalty_discount,
    JSON.stringify(bookingRow),
  );
  check(
    'by exactly the discount',
    bookingRow.loyalty_discount === fifty.discount_value,
    String(bookingRow.loyalty_discount),
  );

  const afterRedeem = (await points(passenger)).points_balance;
  check(
    'the points were spent',
    afterRedeem === balanceNow - fifty.points_required,
    `${balanceNow} -> ${afterRedeem}`,
  );

  const lifetimeAfter = (await points(passenger)).lifetime_points;
  check(
    'but lifetime points did NOT go down',
    lifetimeAfter >= balanceNow,
    String(lifetimeAfter),
  );

  /*
    The bug this catches was found in the browser, not here: applying a reward
    and removing it inflated `lifetime_points`, because returning staked points
    counted as earning them. Lifetime drives tiers later, so a passenger who
    looped apply/remove could climb without travelling. Lifetime must equal the
    sum of EARNED and BONUS credits, and nothing else.
  */
  const lifetimeBeforeLoop = (await points(passenger)).lifetime_points;
  for (let i = 0; i < 3; i += 1) {
    await passenger.supabase.rpc('cancel_reward_redemption', { p_booking_id: b.bookingId });
    await passenger.supabase.rpc('redeem_reward', {
      p_booking_id: b.bookingId,
      p_reward_id: fifty.id,
    });
  }
  const lifetimeAfterLoop = (await points(passenger)).lifetime_points;
  check(
    'applying and removing a reward repeatedly does NOT inflate lifetime points',
    lifetimeAfterLoop === lifetimeBeforeLoop,
    `${lifetimeBeforeLoop} -> ${lifetimeAfterLoop}`,
  );

  const earnedSum = (
    await passenger.supabase.from('loyalty_transactions').select('points, type')
  ).data
    .filter((r) => r.type === 'EARNED' || r.type === 'BONUS')
    .reduce((total, r) => total + r.points, 0);
  check(
    'lifetime equals the sum of EARNED and BONUS credits',
    lifetimeAfterLoop === earnedSum,
    `lifetime ${lifetimeAfterLoop}, earned ${earnedSum}`,
  );

  // The loop above ends with a redemption ACTIVE, which is what the stacking
  // and cancellation checks below need. Removing it here broke them once.

  // Stacking.
  const second = await passenger.supabase.rpc('redeem_reward', {
    p_booking_id: b.bookingId,
    p_reward_id: fifty.id,
  });
  check('a second reward cannot be stacked on the same booking', Boolean(second.error), 'it succeeded');

  // Cancelling the redemption.
  const released = await passenger.supabase.rpc('cancel_reward_redemption', {
    p_booking_id: b.bookingId,
  });
  check('the redemption can be cancelled', !released.error, released.error?.message);
  check(
    'and the points come back',
    (await points(passenger)).points_balance === balanceNow,
    String((await points(passenger)).points_balance),
  );

  const restored = (
    await passenger.supabase
      .from('bookings')
      .select('loyalty_discount, subtotal, total_amount')
      .eq('id', b.bookingId)
      .single()
  ).data;
  check(
    'the booking total is restored',
    restored.loyalty_discount === 0 && restored.total_amount === restored.subtotal,
    JSON.stringify(restored),
  );

  // Cancelling the booking returns staked points too.
  await passenger.supabase.rpc('redeem_reward', {
    p_booking_id: b.bookingId,
    p_reward_id: fifty.id,
  });
  const cancelled = await passenger.supabase.rpc('cancel_booking', { p_booking_id: b.bookingId });
  check(
    'cancelling the booking returns the staked points',
    cancelled.data?.pointsReturned === fifty.points_required,
    JSON.stringify(cancelled.data),
  );
  check(
    'so the balance is whole again',
    (await points(passenger)).points_balance === balanceNow,
    String((await points(passenger)).points_balance),
  );

  // Not enough points.
  const expensive = (
    await passenger.supabase.from('rewards').select('id, points_required').eq('code', 'TWENTY_PERCENT').single()
  ).data;
  const poorBooking = await bookAndBoard(other, bookableTrip.id, 1);
  const poorRedeem = await other.supabase.rpc('redeem_reward', {
    p_booking_id: poorBooking.bookingId,
    p_reward_id: expensive.id,
  });
  check(
    'a passenger with no points cannot redeem',
    poorRedeem.error?.message === 'INSUFFICIENT_POINTS',
    poorRedeem.error?.message,
  );
  const poorBookingRow = (
    await other.supabase.from('bookings').select('loyalty_discount').eq('id', poorBooking.bookingId).single()
  ).data;
  check(
    'and the booking is untouched',
    poorBookingRow.loyalty_discount === 0,
    String(poorBookingRow.loyalty_discount),
  );
  await other.supabase.rpc('cancel_booking', { p_booking_id: poorBooking.bookingId });

  // -------------------------------------------------------------------------
  console.log('\nA discount can never exceed the fare');
  // -------------------------------------------------------------------------

  const cheapTrip = (
    await passenger.supabase
      .from('trip_search')
      .select('id, fare')
      .eq('status', 'SCHEDULED')
      .order('fare')
      .limit(1)
  ).data?.[0];

  const cheapBooking = await bookAndBoard(passenger, cheapTrip.id, 1);
  const hundred = (
    await passenger.supabase.from('rewards').select('id, points_required, discount_value').eq('code', 'HUNDRED_OFF').single()
  ).data;

  // Top up points enough to afford it, the only way available: complete trips.
  // Instead, use the balance we have and pick whichever reward we can afford.
  const affordable = (
    await passenger.supabase
      .from('rewards')
      .select('id, code, points_required, discount_value')
      .lte('points_required', (await points(passenger)).points_balance)
      .order('discount_value', { ascending: false })
      .limit(1)
  ).data?.[0];

  if (affordable) {
    const applied = await passenger.supabase.rpc('redeem_reward', {
      p_booking_id: cheapBooking.bookingId,
      p_reward_id: affordable.id,
    });
    const row = (
      await passenger.supabase
        .from('bookings')
        .select('subtotal, loyalty_discount, total_amount')
        .eq('id', cheapBooking.bookingId)
        .single()
    ).data;

    check(
      'the total never goes below zero',
      row.total_amount >= 0,
      JSON.stringify(row),
    );
    check(
      'and the discount never exceeds the fare',
      row.loyalty_discount <= row.subtotal,
      `discount ${row.loyalty_discount} vs subtotal ${row.subtotal}`,
    );
    check(
      'the arithmetic still adds up',
      row.total_amount === row.subtotal - row.loyalty_discount,
      JSON.stringify(row),
    );
    if (applied.error) check('applying the reward succeeded', false, applied.error.message);
  } else {
    check('a reward is affordable for the cap test', false, 'no affordable reward');
  }

  await passenger.supabase.rpc('cancel_booking', { p_booking_id: cheapBooking.bookingId });
  void hundred;

  // -------------------------------------------------------------------------
  console.log('\nRefund returns staked points');
  // -------------------------------------------------------------------------

  const refundBooking = await bookAndBoard(passenger, bookableTrip.id, 1);
  const balanceBeforeStake = (await points(passenger)).points_balance;
  const stake = (
    await passenger.supabase
      .from('rewards')
      .select('id, points_required')
      .lte('points_required', balanceBeforeStake)
      .order('points_required', { ascending: false })
      .limit(1)
  ).data?.[0];

  if (stake) {
    await passenger.supabase.rpc('redeem_reward', {
      p_booking_id: refundBooking.bookingId,
      p_reward_id: stake.id,
    });
    await payByQr(passenger, refundBooking.bookingId);

    const refund = await passenger.supabase.rpc('refund_test_payment', {
      p_booking_id: refundBooking.bookingId,
    });
    check('a discounted booking can be refunded', !refund.error, refund.error?.message);
    check(
      'and the staked points come back',
      refund.data?.pointsReturned === stake.points_required,
      JSON.stringify(refund.data),
    );
    check(
      'so the balance is restored',
      (await points(passenger)).points_balance === balanceBeforeStake,
      String((await points(passenger)).points_balance),
    );
  } else {
    check('points are available to stake for the refund test', false, `balance ${balanceBeforeStake}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\nThe ledger cannot be rewritten');
// ---------------------------------------------------------------------------

const entry = (await passenger.supabase.from('loyalty_transactions').select('id').limit(1)).data?.[0];

const editEntry = await passenger.supabase
  .from('loyalty_transactions')
  .update({ points: 100000 })
  .eq('id', entry.id)
  .select();
check(
  'a user cannot edit a ledger entry',
  Boolean(editEntry.error) || editEntry.data?.length === 0,
  'the update applied',
);

const deleteEntry = await passenger.supabase
  .from('loyalty_transactions')
  .delete()
  .eq('id', entry.id)
  .select();
check(
  'and cannot delete one',
  Boolean(deleteEntry.error) || deleteEntry.data?.length === 0,
  'the delete applied',
);

const strangerLedger =
  (await other.supabase.from('loyalty_transactions').select('id').eq('user_id', passenger.userId))
    .data ?? [];
check(
  "and cannot read someone else's",
  strangerLedger.length === 0,
  `saw ${strangerLedger.length}`,
);

const finalPoints = await points(passenger);
check(
  'the balance equals the ledger at the end of it all',
  finalPoints.points_balance === (await ledgerSum(passenger)),
  `balance ${finalPoints.points_balance}, ledger ${await ledgerSum(passenger)}`,
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
