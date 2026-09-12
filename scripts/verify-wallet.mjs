/**
 * The mock wallet — verified against the local stack with real signed-in roles.
 *
 *   pnpm db:verify:wallet
 *
 * What this exists to prove, none of which a unit test can show:
 *
 *   - the balance always equals the sum of the ledger, including under
 *     concurrent top-ups that all read the same starting balance
 *   - nobody can write a balance or a ledger row directly, and nobody can edit
 *     or delete one afterwards
 *   - a wallet payment reaches the SAME end state as a QR payment: PAID
 *     payment row, receipt, BOOKED seats, CONFIRMED booking
 *   - the amount is re-derived from the booking, so a client cannot pay ₱1 for
 *     a ₱700 trip
 *   - paying twice charges once; refunding twice credits once
 *   - a refund of a wallet-paid booking goes back to the wallet
 *   - one wallet is invisible to every other user
 *
 * Requires `supabase start`.
 */

import { createClient } from '@supabase/supabase-js';
import { loadVerifyEnv } from './_verify-env.mjs';

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

const peso = (c) => `₱${(c / 100).toFixed(2)}`;

const passenger = await signIn('passenger@palago.test');
const other = await signIn('passenger2@palago.test');
const operator = await signIn('operator@palago.test');

async function wallet(session) {
  const { data } = await session.supabase.from('wallets').select('id, balance, currency').single();
  return data;
}

/** The invariant the whole design rests on: balance === sum(ledger). */
async function ledgerSum(session, walletId) {
  const { data } = await session.supabase
    .from('wallet_transactions')
    .select('amount')
    .eq('wallet_id', walletId);
  return (data ?? []).reduce((total, row) => total + row.amount, 0);
}

// ---------------------------------------------------------------------------
console.log('\nEvery user has a wallet');
// ---------------------------------------------------------------------------

const mine = await wallet(passenger);
/*
  The starting balance is recorded rather than asserted to be zero: `db:reset`
  gives a fresh wallet, but running this suite twice against one database does
  not, and a suite that only passes on a fresh database hides real regressions
  behind a setup requirement.
*/
const openingBalance = mine?.balance ?? 0;
check('a passenger has a wallet', Boolean(mine?.id), JSON.stringify(mine));
check(
  'with a readable balance',
  typeof mine?.balance === 'number' && mine.balance >= 0,
  String(mine?.balance),
);
check('and is denominated in PHP', mine?.currency === 'PHP', mine?.currency);

const operatorWallet = await wallet(operator);
check(
  'an operator account has one too (the trigger fires for every profile)',
  Boolean(operatorWallet?.id),
  JSON.stringify(operatorWallet),
);

// ---------------------------------------------------------------------------
console.log('\nNobody writes a balance directly');
// ---------------------------------------------------------------------------

const directCredit = await passenger.supabase
  .from('wallets')
  .update({ balance: 999999 })
  .eq('id', mine.id)
  .select();
check(
  'a user cannot set their own balance',
  Boolean(directCredit.error) || directCredit.data?.length === 0,
  'the update applied',
);

const directLedger = await passenger.supabase.from('wallet_transactions').insert({
  wallet_id: mine.id,
  type: 'TOP_UP',
  amount: 500000,
  balance_before: 0,
  balance_after: 500000,
});
check(
  'and cannot write a ledger row',
  Boolean(directLedger.error),
  'the insert succeeded',
);

const anonRead = (await client().from('wallets').select('id')).data ?? [];
check('an anonymous caller sees no wallets', anonRead.length === 0, `saw ${anonRead.length}`);

// ---------------------------------------------------------------------------
console.log('\nTop-up');
// ---------------------------------------------------------------------------

const badAmount = await passenger.supabase.rpc('top_up_wallet', { p_amount: 0 });
check('a zero top-up is refused', Boolean(badAmount.error), 'it succeeded');

const negative = await passenger.supabase.rpc('top_up_wallet', { p_amount: -100000 });
check('a negative top-up is refused', Boolean(negative.error), 'it succeeded');

const tooBig = await passenger.supabase.rpc('top_up_wallet', { p_amount: 99_000_000 });
check('a top-up over the per-transaction cap is refused', Boolean(tooBig.error), 'it succeeded');

const topUp = await passenger.supabase.rpc('top_up_wallet', { p_amount: 200000 });
check('a valid top-up succeeds', !topUp.error, topUp.error?.message);
check(
  `and the balance rose by exactly ${peso(200000)}`,
  topUp.data?.balance === openingBalance + 200000,
  `${openingBalance} -> ${topUp.data?.balance}`,
);

const anonTopUp = await client().rpc('top_up_wallet', { p_amount: 100000 });
check('an anonymous caller cannot top up', Boolean(anonTopUp.error), 'it succeeded');

// Idempotency: the retry-after-dropped-response case.
const key = `verify-${Date.now()}`;
const first = await passenger.supabase.rpc('top_up_wallet', {
  p_amount: 100000,
  p_idempotency_key: key,
});
const second = await passenger.supabase.rpc('top_up_wallet', {
  p_amount: 100000,
  p_idempotency_key: key,
});
check('a keyed top-up applies once', first.data?.alreadyApplied === false, JSON.stringify(first.data));
check(
  'and a retry with the same key does not credit again',
  second.data?.alreadyApplied === true,
  JSON.stringify(second.data),
);

const afterKeyed = await wallet(passenger);
check(
  `the balance rose by ${peso(100000)}, not ${peso(200000)}`,
  afterKeyed.balance === openingBalance + 300000,
  `${openingBalance} -> ${afterKeyed.balance}`,
);

/*
  The cap, from whichever side there is room on. Both outcomes are meaningful:
  with headroom the top-up must succeed, and without it the cap must refuse --
  so this asserts the correct one rather than skipping.
*/
const headroom = 5000000 - afterKeyed.balance;
const capAttempt = await passenger.supabase.rpc('top_up_wallet', { p_amount: 1000000 });
if (headroom >= 1000000) {
  check('topping up with headroom is allowed', !capAttempt.error, capAttempt.error?.message);
} else {
  check(
    'topping up past the balance cap is refused',
    capAttempt.error?.message === 'WALLET_LIMIT_EXCEEDED',
    capAttempt.error?.message,
  );
}

// ---------------------------------------------------------------------------
console.log('\nConcurrent top-ups do not lose money');
//
// Eight simultaneous callers, all reading the same starting balance if the
// function did not lock. This is the wallet's version of the Phase 4 seat race.
// ---------------------------------------------------------------------------

const before = (await wallet(passenger)).balance;
const results = await Promise.all(
  Array.from({ length: 8 }, () =>
    passenger.supabase.rpc('top_up_wallet', { p_amount: 10000 }),
  ),
);
const succeeded = results.filter((r) => !r.error).length;
const after = (await wallet(passenger)).balance;

check(
  'all eight concurrent top-ups succeed',
  succeeded === 8,
  `${succeeded}/8: ${results.find((r) => r.error)?.error?.message ?? ''}`,
);
check(
  'and every centavo lands (no lost update)',
  after === before + 8 * 10000,
  `${before} -> ${after}, expected ${before + 8 * 10000}`,
);
check(
  'the balance still equals the ledger sum',
  after === (await ledgerSum(passenger, mine.id)),
  `balance ${after}, ledger ${await ledgerSum(passenger, mine.id)}`,
);

// ---------------------------------------------------------------------------
console.log('\nOne wallet is invisible to everyone else');
// ---------------------------------------------------------------------------

const strangerWallets = (await other.supabase.from('wallets').select('id, balance')).data ?? [];
check(
  'another passenger sees only their own wallet',
  strangerWallets.length === 1 && strangerWallets[0].id !== mine.id,
  JSON.stringify(strangerWallets),
);

const strangerLedger =
  (await other.supabase.from('wallet_transactions').select('id').eq('wallet_id', mine.id)).data ??
  [];
check(
  "and none of someone else's ledger",
  strangerLedger.length === 0,
  `saw ${strangerLedger.length}`,
);

const strangerBalance = (await other.supabase.from('wallets').select('balance').single()).data;
check(
  'their own balance is unaffected by our top-ups',
  strangerBalance?.balance !== afterKeyed.balance,
  `theirs ${strangerBalance?.balance}, ours ${afterKeyed.balance}`,
);

// ---------------------------------------------------------------------------
console.log('\nPaying a booking from the wallet');
// ---------------------------------------------------------------------------

const trip = (
  await passenger.supabase
    .from('trip_search')
    .select('id, fare')
    .eq('status', 'SCHEDULED')
    .limit(1)
).data?.[0];

if (!trip) {
  check('a bookable trip exists (seed data)', false, 'none found');
} else {
  const booking = await passenger.supabase.rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: [0, 1].map((i) => ({
      name: i === 0 ? 'Wallet Test' : 'Wallet Two',
      phone: '09171234567',
      email: null,
      type: 'ADULT',
    })),
  });
  check('a booking can be made', !booking.error, booking.error?.message);

  const total = booking.data.totalAmount;
  const balanceBefore = (await wallet(passenger)).balance;

  // Someone else's booking is not yours to pay for.
  const foreignPay = await other.supabase.rpc('pay_booking_with_wallet', {
    p_booking_id: booking.data.bookingId,
  });
  check(
    "another user cannot pay someone else's booking from their wallet",
    Boolean(foreignPay.error),
    'it succeeded',
  );

  const paid = await passenger.supabase.rpc('pay_booking_with_wallet', {
    p_booking_id: booking.data.bookingId,
  });
  check('the owner can pay from their wallet', !paid.error, paid.error?.message);
  check(
    'the booking is CONFIRMED',
    paid.data?.bookingStatus === 'CONFIRMED',
    JSON.stringify(paid.data),
  );
  check('a receipt was issued', Boolean(paid.data?.receiptNumber), JSON.stringify(paid.data));

  const balanceAfter = (await wallet(passenger)).balance;
  check(
    `exactly the booking total was debited (${peso(total)})`,
    balanceAfter === balanceBefore - total,
    `${balanceBefore} -> ${balanceAfter}, total ${total}`,
  );
  check(
    'the ledger still sums to the balance',
    balanceAfter === (await ledgerSum(passenger, mine.id)),
    `balance ${balanceAfter}, ledger ${await ledgerSum(passenger, mine.id)}`,
  );

  // The end state must be indistinguishable from a QR payment.
  const payment = (
    await passenger.supabase
      .from('payments')
      .select('status, provider, amount, receipt_number')
      .eq('booking_id', booking.data.bookingId)
      .eq('status', 'PAID')
      .single()
  ).data;
  check('a PAID payment row exists', payment?.status === 'PAID', JSON.stringify(payment));
  check('with provider MOCK', payment?.provider === 'MOCK', payment?.provider);
  check('for the booking total', payment?.amount === total, `${payment?.amount} vs ${total}`);

  const bookedSeats = (
    await passenger.supabase
      .from('trip_seats')
      .select('status')
      .eq('booking_id', booking.data.bookingId)
  ).data ?? [];
  check(
    'the seats are BOOKED, not still HELD',
    bookedSeats.length > 0 && bookedSeats.every((s) => s.status === 'BOOKED'),
    JSON.stringify(bookedSeats.map((s) => s.status)),
  );

  const receipt = (
    await passenger.supabase
      .from('receipts')
      .select('payment_method, amount')
      .eq('booking_id', booking.data.bookingId)
      .single()
  ).data;
  check(
    'the receipt records it as a wallet payment',
    receipt?.payment_method === 'PalaGo Wallet',
    JSON.stringify(receipt),
  );

  // A boarding pass is the real downstream consumer of "did they pay".
  const pass = await fetch(`${URL_}/functions/v1/get-boarding-pass`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: KEY,
      Authorization: `Bearer ${passenger.accessToken}`,
    },
    body: JSON.stringify({ bookingId: booking.data.bookingId }),
  }).then((r) => r.json());
  check(
    'a boarding pass is issued for a wallet-paid booking',
    Boolean(pass?.data?.token),
    JSON.stringify(pass?.code ?? pass),
  );

  // Idempotency.
  const payTwice = await passenger.supabase.rpc('pay_booking_with_wallet', {
    p_booking_id: booking.data.bookingId,
  });
  check(
    'paying the same booking twice is idempotent',
    !payTwice.error && payTwice.data?.alreadyPaid === true,
    payTwice.error?.message ?? JSON.stringify(payTwice.data),
  );
  const balanceAfterTwice = (await wallet(passenger)).balance;
  check(
    'and does NOT debit a second time',
    balanceAfterTwice === balanceAfter,
    `${balanceAfter} -> ${balanceAfterTwice}`,
  );

  // -------------------------------------------------------------------------
  console.log('\nRefund goes back to the wallet it came from');
  // -------------------------------------------------------------------------

  const refunded = await passenger.supabase.rpc('refund_test_payment', {
    p_booking_id: booking.data.bookingId,
  });
  check('the booking can be refunded', !refunded.error, refunded.error?.message);
  check(
    'and the refund is marked as going to the wallet',
    refunded.data?.refundedToWallet === true,
    JSON.stringify(refunded.data),
  );

  const balanceRestored = (await wallet(passenger)).balance;
  check(
    'the balance is back to what it was before paying',
    balanceRestored === balanceBefore,
    `${balanceRestored} vs ${balanceBefore}`,
  );

  const refundTwice = await passenger.supabase.rpc('refund_test_payment', {
    p_booking_id: booking.data.bookingId,
  });
  check(
    'refunding twice is idempotent',
    !refundTwice.error && refundTwice.data?.alreadyRefunded === true,
    refundTwice.error?.message ?? JSON.stringify(refundTwice.data),
  );
  const balanceAfterDoubleRefund = (await wallet(passenger)).balance;
  check(
    'and does NOT credit a second time',
    balanceAfterDoubleRefund === balanceRestored,
    `${balanceRestored} -> ${balanceAfterDoubleRefund}`,
  );
  check(
    'the ledger still sums to the balance after the round trip',
    balanceAfterDoubleRefund === (await ledgerSum(passenger, mine.id)),
    `balance ${balanceAfterDoubleRefund}, ledger ${await ledgerSum(passenger, mine.id)}`,
  );

  // -------------------------------------------------------------------------
  console.log('\nInsufficient funds');
  // -------------------------------------------------------------------------

  const poorBooking = await other.supabase.rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: [
      { name: 'Broke Test', phone: '09171234567', email: null, type: 'ADULT' },
    ],
  });

  const poorPay = await other.supabase.rpc('pay_booking_with_wallet', {
    p_booking_id: poorBooking.data.bookingId,
  });
  check(
    'an empty wallet cannot pay for a booking',
    Boolean(poorPay.error),
    'the payment succeeded',
  );
  check(
    'and the message says why',
    poorPay.error?.message === 'INSUFFICIENT_FUNDS',
    poorPay.error?.message,
  );

  const poorBookingStatus = (
    await other.supabase
      .from('bookings')
      .select('status')
      .eq('id', poorBooking.data.bookingId)
      .single()
  ).data;
  check(
    'the booking is left alone, not half-paid',
    poorBookingStatus?.status === 'PAYMENT_PENDING',
    poorBookingStatus?.status,
  );

  const poorPayments =
    (await other.supabase
      .from('payments')
      .select('id')
      .eq('booking_id', poorBooking.data.bookingId)
      .eq('status', 'PAID')).data ?? [];
  check(
    'and no PAID payment row was left behind',
    poorPayments.length === 0,
    `saw ${poorPayments.length}`,
  );

  await other.supabase.rpc('cancel_booking', { p_booking_id: poorBooking.data.bookingId });
}

// ---------------------------------------------------------------------------
console.log('\nThe ledger cannot be rewritten');
// ---------------------------------------------------------------------------

const anyEntry = (
  await passenger.supabase.from('wallet_transactions').select('id').limit(1)
).data?.[0];

const editEntry = await passenger.supabase
  .from('wallet_transactions')
  .update({ amount: 5000000 })
  .eq('id', anyEntry.id)
  .select();
check(
  'a user cannot edit their own ledger entry',
  Boolean(editEntry.error) || editEntry.data?.length === 0,
  'the update applied',
);

const deleteEntry = await passenger.supabase
  .from('wallet_transactions')
  .delete()
  .eq('id', anyEntry.id)
  .select();
check(
  'and cannot delete one',
  Boolean(deleteEntry.error) || deleteEntry.data?.length === 0,
  'the delete applied',
);

const finalBalance = (await wallet(passenger)).balance;
check(
  'the balance still equals the ledger at the end of it all',
  finalBalance === (await ledgerSum(passenger, mine.id)),
  `balance ${finalBalance}, ledger ${await ledgerSum(passenger, mine.id)}`,
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
