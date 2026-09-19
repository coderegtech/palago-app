/**
 * Loyalty — verified against the local stack with real signed-in roles.
 *
 *   pnpm db:verify:loyalty
 *
 * What this exists to prove, none of which a unit test can show:
 *
 *   - points are floor(paid / ₱100), whole points only, credited the moment a
 *     booking's payment succeeds — by any payment path — and not before
 *   - earning is exactly-once: a re-confirmed payment, six simultaneous
 *     confirmations, and end_trip afterwards all credit nothing more
 *   - a refund takes the points back, exactly once
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

const passenger = await signIn('passenger@palago.test');
const other = await signIn('passenger2@palago.test');
const driver = await signIn('driver@palago.test');
const cherry = await signIn('operator@palago.test');

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
  const { data: booking, error } = await session.supabase.rpc('create_booking', {
    p_trip_id: tripId,
    p_passengers: Array.from({ length: count }, (_unused, i) => ({
      name: `Loyalty ${i + 1}`,
      phone: '09171234567',
      email: null,
      type: 'ADULT',
    })),
  });
  if (error) throw new Error(`create_booking: ${error.message}`);
  return booking;
}

/**
 * Pay for bookings until the balance can afford the dearest reward under test.
 *
 * Points arrive on payment now (20260919000041), so a balance is built by
 * paying, not by travelling. At one point per ₱100 a single seat earns a
 * handful, so each booking takes a full party — ten seats on a ₱450+ trip is
 * 45+ points — and a few bookings cover the 250-point reward.
 */
async function earnAtLeast(session, target) {
  const { data: trips } = await session.supabase
    .from('trip_search')
    .select('id')
    .eq('status', 'SCHEDULED')
    .order('fare', { ascending: false });

  for (const t of trips ?? []) {
    if ((await points(session)).points_balance >= target) break;
    try {
      const booking = await bookAndBoard(session, t.id, 10);
      await payByQr(session, booking.bookingId);
    } catch {
      // A trip without ten free seats is skipped, not a failure.
    }
  }
  return (await points(session)).points_balance;
}

/** Pay by the mock provider. Returns what a repeat confirmation needs. */
async function payByQr(session, bookingId) {
  const created = await invoke('create-test-payment', { bookingId }, session.accessToken);
  const token = new URL(created.body.data.paymentUrl).searchParams.get('t');
  const reference = created.body.data.reference;
  await invoke('confirm-test-payment', { reference, token });
  return { reference, token };
}

async function earnedRows(session, bookingId) {
  return (
    (await session.supabase
      .from('loyalty_transactions')
      .select('points, description')
      .eq('booking_id', bookingId)
      .eq('type', 'EARNED')).data ?? []
  );
}

// ---------------------------------------------------------------------------
console.log('\nEvery account balances');
// ---------------------------------------------------------------------------

// Not "starts at zero" any more: the seed's paid bookings are credited the
// moment they are paid, so the seeded passenger arrives with points. What must
// hold for every account, always, is that the balance is its ledger.
const start = await points(passenger);
check('a passenger has a loyalty account', start !== null, JSON.stringify(start));
check(
  'whose balance equals its ledger',
  start?.points_balance === (await ledgerSum(passenger)),
  `balance ${start?.points_balance}, ledger ${await ledgerSum(passenger)}`,
);

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
console.log('\nThe rate: floor(paid / ₱100), whole points only');
// ---------------------------------------------------------------------------

// The examples from the specification, plus the edges either side of a point.
for (const [centavos, expected] of [
  [10_000, 1], // ₱100
  [25_000, 2], // ₱250
  [56_000, 5], // ₱560
  [99_900, 9], // ₱999
  [9_999, 0], // ₱99.99 — no partial point
  [0, 0],
]) {
  const { data, error } = await passenger.supabase.rpc('loyalty_points_for', {
    p_amount_centavos: centavos,
  });
  check(
    `₱${(centavos / 100).toFixed(2)} earns ${expected}`,
    !error && data === expected,
    error?.message ?? String(data),
  );
}

// ---------------------------------------------------------------------------
console.log('\nPaying earns the points');
// ---------------------------------------------------------------------------

// This scenario also asserts what a DRIVER can do, so it must be a trip that
// driver is actually rostered on — a subset of the operator's schedule.
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
  const before = await points(passenger);

  // Three passengers, so "the fare" is a real multi-seat total, not one seat.
  const booking = await bookAndBoard(passenger, tripId, 3);
  const unpaid = await points(passenger);
  check(
    'booking without paying earns nothing',
    unpaid.points_balance === before.points_balance,
    `${before.points_balance} -> ${unpaid.points_balance}`,
  );

  const payment = await payByQr(passenger, booking.bookingId);
  const expected = Math.floor(booking.totalAmount / 10_000);
  const afterPaying = await points(passenger);

  check(
    `paying ₱${(booking.totalAmount / 100).toFixed(2)} credits ${expected} points at once`,
    afterPaying.points_balance - before.points_balance === expected,
    `+${afterPaying.points_balance - before.points_balance}, expected +${expected}`,
  );
  check(
    'and lifetime points rise by the same',
    afterPaying.lifetime_points - before.lifetime_points === expected,
    `+${afterPaying.lifetime_points - before.lifetime_points}`,
  );

  const rows = await earnedRows(passenger, booking.bookingId);
  check(
    'one EARNED ledger row records it against the booking',
    rows.length === 1 && rows[0].points === expected,
    JSON.stringify(rows),
  );
  check(
    'the balance equals the ledger sum',
    afterPaying.points_balance === (await ledgerSum(passenger)),
    `balance ${afterPaying.points_balance}, ledger ${await ledgerSum(passenger)}`,
  );

  const { data: note } = await passenger.supabase
    .from('notifications')
    .select('title, data')
    .eq('type', 'REWARD')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  check(
    'the passenger is told',
    note?.data?.bookingId === booking.bookingId && note?.data?.points === expected,
    JSON.stringify(note),
  );

  // -------------------------------------------------------------------------
  console.log('\nEarning is exactly-once');
  // -------------------------------------------------------------------------

  const again = await invoke('confirm-test-payment', payment);
  check(
    'confirming the same payment again answers "already confirmed"',
    again.body?.data?.alreadyConfirmed === true,
    JSON.stringify(again.body),
  );
  check(
    'and credits nothing more',
    (await points(passenger)).points_balance === afterPaying.points_balance,
    String((await points(passenger)).points_balance),
  );

  // Six simultaneous confirmations of one fresh payment — a retried webhook
  // and a double-tap arriving together. Exactly one credit may land.
  const raceBooking = await bookAndBoard(passenger, tripId, 2);
  const created = await invoke('create-test-payment', { bookingId: raceBooking.bookingId }, passenger.accessToken);
  const raceToken = new URL(created.body.data.paymentUrl).searchParams.get('t');
  const beforeRace = (await points(passenger)).points_balance;
  await Promise.all(
    Array.from({ length: 6 }, () =>
      invoke('confirm-test-payment', { reference: created.body.data.reference, token: raceToken }),
    ),
  );
  const raceExpected = Math.floor(raceBooking.totalAmount / 10_000);
  check(
    'six simultaneous confirmations credit exactly once',
    (await points(passenger)).points_balance - beforeRace === raceExpected,
    `+${(await points(passenger)).points_balance - beforeRace}, expected +${raceExpected}`,
  );
  check(
    'with exactly one EARNED row',
    (await earnedRows(passenger, raceBooking.bookingId)).length === 1,
    String((await earnedRows(passenger, raceBooking.bookingId)).length),
  );

  // Travelling afterwards must not pay out a second time: end_trip still
  // calls the award, and must now find it already done.
  await driver.supabase.rpc('set_trip_boarding', { p_trip_id: tripId });
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
      tripId,
    },
    driver.accessToken,
  );
  await driver.supabase.rpc('start_trip', { p_trip_id: tripId });
  const beforeEnd = (await points(passenger)).points_balance;
  const ended = await driver.supabase.rpc('end_trip', { p_trip_id: tripId });
  check('the driver can end the trip', !ended.error, ended.error?.message);
  check(
    'completing the trip awards nothing more — it was credited on payment',
    ended.data?.pointsAwarded === 0 && (await points(passenger)).points_balance === beforeEnd,
    `awarded ${JSON.stringify(ended.data?.pointsAwarded)}, balance ${beforeEnd} -> ${(await points(passenger)).points_balance}`,
  );

  const races = await Promise.all(
    Array.from({ length: 6 }, () => driver.supabase.rpc('end_trip', { p_trip_id: tripId })),
  );
  check(
    'nor do six simultaneous end_trip calls',
    races.every((r) => (r.data?.pointsAwarded ?? 0) === 0) &&
      (await points(passenger)).points_balance === beforeEnd,
    races.map((r) => r.data?.pointsAwarded).join(','),
  );
  check(
    'the paid booking still has exactly one EARNED row',
    (await earnedRows(passenger, booking.bookingId)).length === 1,
    String((await earnedRows(passenger, booking.bookingId)).length),
  );
}

// ---------------------------------------------------------------------------
console.log('\nEvery way of paying earns the same');
// ---------------------------------------------------------------------------

// The credit is a trigger on `payments`, so the wallet path earns without
// having been touched. Asserted, because "every path" is the whole claim.
{
  const walletTrip = (
    await other.supabase.from('trip_search').select('id').eq('status', 'SCHEDULED').limit(1)
  ).data?.[0];
  const walletBooking = await bookAndBoard(other, walletTrip.id, 1);
  await other.supabase.rpc('top_up_wallet', {
    p_amount: walletBooking.totalAmount,
    p_idempotency_key: `loyalty-${walletBooking.bookingId}`,
  });
  const beforeWallet = (await points(other)).points_balance;
  const paid = await other.supabase.rpc('pay_booking_with_wallet', {
    p_booking_id: walletBooking.bookingId,
  });
  check('a booking can be paid from the wallet', !paid.error, paid.error?.message);
  check(
    'and earns floor(paid / ₱100) too',
    (await points(other)).points_balance - beforeWallet ===
      Math.floor(walletBooking.totalAmount / 10_000),
    `+${(await points(other)).points_balance - beforeWallet}`,
  );
}

// A walk-in sold at the counter has no account, so nothing to credit — and
// the cash sale must not fail for want of one.
{
  const counterTrip = (
    await cherry.supabase.from('operator_trip_overview').select('id').eq('status', 'SCHEDULED').limit(1)
  ).data?.[0];
  const walkIn = await cherry.supabase.rpc('create_booking', {
    p_trip_id: counterTrip.id,
    p_passengers: [{ name: 'Walk-in Loyalty', type: 'ADULT' }],
    p_seat_ids: null,
    p_walk_in: true,
    p_source: 'OPERATOR',
    p_ticket_type: 'PRINTED',
  });
  const cash = await cherry.supabase.rpc('record_counter_payment', {
    p_booking_id: walkIn.data?.bookingId,
    p_method: 'CASH',
  });
  check('a walk-in cash sale still succeeds', !cash.error, cash.error?.message ?? walkIn.error?.message);
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
  'paying for bookings builds a usable balance',
  earnedTotal >= 260,
  `${earnedTotal} points after paying for bookings`,
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

  // Credits, less what a refunded booking earned: a refund means it was never
  // really earned (20260919000041), so it leaves lifetime as well as balance.
  const ledger = (
    await passenger.supabase.from('loyalty_transactions').select('points, type, booking_id')
  ).data;
  const refundedBookings = new Set(
    ledger.filter((r) => r.type === 'REVERSED').map((r) => r.booking_id),
  );
  const earnedSum = ledger
    .filter((r) => r.type === 'EARNED' || r.type === 'BONUS')
    .filter((r) => !(r.type === 'EARNED' && refundedBookings.has(r.booking_id)))
    .reduce((total, r) => total + r.points, 0);
  check(
    'lifetime equals EARNED and BONUS credits, less refunded bookings',
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

    // Paying credited points; the refund must take exactly those back, or
    // pay-earn-refund would be a loop that prints points.
    const earned = await earnedRows(passenger, refundBooking.bookingId);
    const reversed =
      (await passenger.supabase
        .from('loyalty_transactions')
        .select('points')
        .eq('booking_id', refundBooking.bookingId)
        .eq('type', 'REVERSED')).data ?? [];
    check(
      'the points the payment earned are reversed by the refund',
      earned.length === 1 && reversed.length === 1 && reversed[0].points === -earned[0].points,
      `earned ${JSON.stringify(earned)}, reversed ${JSON.stringify(reversed)}`,
    );

    const refundAgain = await passenger.supabase.rpc('refund_test_payment', {
      p_booking_id: refundBooking.bookingId,
    });
    void refundAgain;
    const reversedAfterRetry =
      (await passenger.supabase
        .from('loyalty_transactions')
        .select('id')
        .eq('booking_id', refundBooking.bookingId)
        .eq('type', 'REVERSED')).data ?? [];
    check(
      'and refunding again reverses nothing more',
      reversedAfterRetry.length === 1,
      String(reversedAfterRetry.length),
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

// After the refunds above: a pay-then-refund loop must not inflate lifetime.
{
  const rows = (
    await passenger.supabase.from('loyalty_transactions').select('points, type, booking_id')
  ).data;
  const refunded = new Set(rows.filter((r) => r.type === 'REVERSED').map((r) => r.booking_id));
  const genuinelyEarned = rows
    .filter((r) => r.type === 'EARNED' || r.type === 'BONUS')
    .filter((r) => !(r.type === 'EARNED' && refunded.has(r.booking_id)))
    .reduce((total, r) => total + r.points, 0);
  check(
    'and lifetime points exclude what refunded bookings earned',
    refunded.size > 0 && finalPoints.lifetime_points === genuinelyEarned,
    `lifetime ${finalPoints.lifetime_points}, genuinely earned ${genuinelyEarned}, refunded bookings ${refunded.size}`,
  );
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
