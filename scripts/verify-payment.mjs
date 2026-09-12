/**
 * Mock payment flow, verified against the local stack and the real Edge
 * Functions.
 *
 *   pnpm db:verify:payment
 *
 * Covers the scenarios in the spec, and in particular the two that cannot be
 * shown with a unit test:
 *
 *   - confirming five times leaves ONE payment, ONE receipt, ONE confirmation
 *   - the payment token is genuinely required, and a wrong one is
 *     indistinguishable from a missing payment
 *
 * Requires `supabase start` (the Edge Runtime container serves the functions).
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { loadVerifyEnv } from './_verify-env.mjs';

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

/** Calls an Edge Function the way the app does. */
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
const admin = await signIn('admin@palago.test');

/** A fresh booking, so each run starts from PAYMENT_PENDING. */
async function freshBooking(supabase, seatCount = 2) {
  const { data: trips } = await supabase
    .from('trips')
    .select('id, fare, trip_number')
    .eq('status', 'SCHEDULED')
    .order('departure_date')
    .limit(1);
  const trip = trips[0];

  const { data, error } = await supabase.rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: Array.from({ length: seatCount }, (_unused, i) => ({
      name: i === 0 ? 'Juan Dela Cruz' : `Passenger ${i + 1}`,
      phone: '09171234567',
      email: null,
      type: 'ADULT',
    })),
  });
  if (error) throw new Error(`create_booking failed: ${error.message}`);
  return { booking: data, trip };
}

// Start clean so a previous run's holds cannot starve this one.
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

// ---------------------------------------------------------------------------
console.log('\nScenario 1-3: booking, payment creation, payment URL');
// ---------------------------------------------------------------------------
const { booking, trip } = await freshBooking(passenger.supabase, 2);
check('a new booking is PAYMENT_PENDING', booking.status === 'PAYMENT_PENDING', booking.status);

const created = await invoke(
  'create-test-payment',
  { bookingId: booking.bookingId },
  passenger.accessToken,
);
check('create-test-payment succeeds', created.body?.success === true, JSON.stringify(created.body));

const payment = created.body?.data;
check('the payment opens PENDING', payment?.status === 'PENDING', payment?.status);
check(
  'the reference looks like PAY-YYYY-NNNNNN',
  /^PAY-\d{4}-\d{6}$/.test(payment?.reference ?? ''),
  payment?.reference,
);
check(
  'the amount equals the booking total, not anything the client sent',
  payment?.amount === trip.fare * 2,
  `${payment?.amount} vs ${trip.fare * 2}`,
);
check('the provider is MOCK', payment?.provider === 'MOCK', payment?.provider);

let token = null;
try {
  const url = new URL(payment.paymentUrl);
  token = url.searchParams.get('t');
  check(
    'the payment URL points at the payment page',
    url.pathname === `/payment/${payment.reference}`,
    url.pathname,
  );
  check('the payment URL carries a token', (token ?? '').length >= 32, `${token?.length} chars`);
} catch {
  check('the payment URL is a valid URL', false, payment?.paymentUrl);
}

// ---------------------------------------------------------------------------
console.log('\nIdempotent creation');
// ---------------------------------------------------------------------------
{
  const again = await invoke(
    'create-test-payment',
    { bookingId: booking.bookingId },
    passenger.accessToken,
  );
  check('creating twice reuses the live payment', again.body?.data?.reused === true);
  check(
    'and returns the same reference',
    again.body?.data?.reference === payment.reference,
    `${again.body?.data?.reference} vs ${payment.reference}`,
  );

  const { data: rows } = await admin.supabase
    .from('payments')
    .select('id, payment_url')
    .eq('booking_id', booking.bookingId);
  check('only one payment row exists', rows?.length === 1, `${rows?.length} rows`);

  // Regression guard. The Edge Function once tried to write this column as the
  // signed-in user, which RLS correctly refused, and a `console.error` hid the
  // failure — leaving a payment whose QR screen could never be reopened.
  check(
    'the payment URL is persisted, not just returned',
    rows?.[0]?.payment_url === payment.paymentUrl,
    `stored: ${rows?.[0]?.payment_url ?? 'null'}`,
  );
}

// ---------------------------------------------------------------------------
console.log('\nAuthorisation of creation');
// ---------------------------------------------------------------------------
{
  const anon = await invoke('create-test-payment', { bookingId: booking.bookingId });
  check('an anonymous caller cannot create a payment', anon.body?.success === false, `${anon.status}`);

  const { booking: theirs } = await freshBooking(other.supabase, 1);
  const crossUser = await invoke(
    'create-test-payment',
    { bookingId: theirs.bookingId },
    passenger.accessToken,
  );
  check(
    "a passenger cannot open a payment on someone else's booking",
    crossUser.body?.success === false &&
      ['FORBIDDEN', 'NOT_FOUND'].includes(crossUser.body?.code),
    crossUser.body?.code,
  );
}

// ---------------------------------------------------------------------------
console.log('\nScenario 4: the public payment page reads its payment');
// ---------------------------------------------------------------------------
{
  const missing = await invoke('get-payment', { reference: payment.reference });
  check('a link with no token is refused', missing.body?.code === 'INVALID_QR', missing.body?.code);

  const wrong = await invoke('get-payment', {
    reference: payment.reference,
    token: 'f'.repeat(64),
  });
  check(
    'a wrong token is indistinguishable from a missing payment',
    wrong.body?.code === 'NOT_FOUND',
    wrong.body?.code,
  );

  const got = await invoke('get-payment', { reference: payment.reference, token });
  check('the correct token reads the payment', got.body?.success === true, got.body?.code);

  const p = got.body?.data;
  check('it includes the booking reference', Boolean(p?.bookingReference));
  check('it includes the fare breakdown', p?.totalAmount === payment.amount);
  check('it includes both passengers', p?.passengers?.length === 2);
  // This page is shown before paying, and seats are assigned after. An inner
  // join on the seat once made the page list nobody at all.
  check(
    'with no seat numbers yet — those come when this payment is verified',
    (p?.passengers ?? []).every((x) => x.seat === null),
    JSON.stringify((p?.passengers ?? []).map((x) => x.seat)),
  );
  check('no receipt exists before confirmation', p?.receipt === null);

  // The token is the credential; echoing it back would be a needless leak.
  const serialised = JSON.stringify(p);
  check('the response never echoes the token', !serialised.includes(token), 'token found in body');
  check(
    'the response exposes no user id',
    !serialised.includes('user_id') && !serialised.includes('userId'),
  );
}

// ---------------------------------------------------------------------------
console.log('\nScenario 5-6: confirmation, and confirming five times');
// ---------------------------------------------------------------------------
{
  const first = await invoke('confirm-test-payment', { reference: payment.reference, token });
  check('confirm-test-payment succeeds', first.body?.success === true, JSON.stringify(first.body));

  const r = first.body?.data;
  check('payment becomes PAID', r?.paymentStatus === 'PAID', r?.paymentStatus);
  check('booking becomes CONFIRMED', r?.bookingStatus === 'CONFIRMED', r?.bookingStatus);
  check(
    'a receipt number is issued in the RCP-YYYY-NNNNNN format',
    /^RCP-\d{4}-\d{6}$/.test(r?.receiptNumber ?? ''),
    r?.receiptNumber,
  );
  check('the first confirmation is not flagged as a repeat', r?.alreadyConfirmed === false);

  // The scenario the spec calls out explicitly.
  const repeats = [];
  for (let i = 0; i < 4; i += 1) {
    repeats.push(await invoke('confirm-test-payment', { reference: payment.reference, token }));
  }

  check(
    'four further confirmations all succeed',
    repeats.every((x) => x.body?.success === true),
    repeats.map((x) => x.body?.code).join(', '),
  );
  check(
    'each repeat reports alreadyConfirmed',
    repeats.every((x) => x.body?.data?.alreadyConfirmed === true),
  );
  check(
    'every repeat returns the SAME receipt number',
    repeats.every((x) => x.body?.data?.receiptNumber === r.receiptNumber),
    repeats.map((x) => x.body?.data?.receiptNumber).join(', '),
  );

  const { data: receipts } = await admin.supabase
    .from('receipts')
    .select('id')
    .eq('booking_id', booking.bookingId);
  check('exactly ONE receipt row exists after five calls', receipts?.length === 1, `${receipts?.length}`);

  const { data: paid } = await admin.supabase
    .from('payments')
    .select('id, status')
    .eq('booking_id', booking.bookingId);
  check('exactly ONE payment row, and it is PAID', paid?.length === 1 && paid[0].status === 'PAID');

  const { data: seats } = await admin.supabase
    .from('trip_seats')
    .select('status, confirmed_at, held_until')
    .eq('booking_id', booking.bookingId);
  check('the seats moved HELD to BOOKED', seats?.every((s) => s.status === 'BOOKED'), JSON.stringify(seats?.map((s) => s.status)));

  // The other half of payment-before-seat: now, and only now, each passenger
  // has a seat number.
  const { data: seated } = await admin.supabase
    .from('booking_passengers')
    .select('passenger_name, seat_id')
    .eq('booking_id', booking.bookingId);
  check(
    'and every passenger is now assigned one',
    (seated?.length ?? 0) === 2 && seated.every((x) => x.seat_id !== null),
    JSON.stringify(seated?.map((x) => x.seat_id)),
  );
  check(
    'each to a different seat',
    new Set((seated ?? []).map((x) => x.seat_id)).size === (seated?.length ?? 0),
  );
  check('the seats carry a confirmation time', seats?.every((s) => s.confirmed_at !== null));
  check('the seats no longer carry a hold deadline', seats?.every((s) => s.held_until === null));

  const { data: ledger } = await admin.supabase
    .from('payment_transactions')
    .select('type')
    .eq('payment_id', paid[0].id)
    .order('created_at');
  check(
    'the ledger records CREATED then PAID, once each',
    JSON.stringify(ledger?.map((x) => x.type)) === JSON.stringify(['CREATED', 'PAID']),
    JSON.stringify(ledger?.map((x) => x.type)),
  );

  const { data: audit } = await admin.supabase
    .from('audit_logs')
    .select('action, ip_address')
    .eq('entity_id', paid[0].id)
    .order('created_at');
  check(
    'the audit trail records creation and confirmation once each',
    JSON.stringify(audit?.map((x) => x.action)) ===
      JSON.stringify(['PAYMENT_CREATED', 'TEST_PAYMENT_CONFIRMED']),
    JSON.stringify(audit?.map((x) => x.action)),
  );

  // Scoped to THIS booking. Counting every PAYMENT_CONFIRMED notification in
  // the database would also count earlier runs' confirmations and fail for a
  // reason that has nothing to do with idempotency.
  const { data: notes } = await admin.supabase
    .from('notifications')
    .select('type, title')
    .eq('type', 'PAYMENT_CONFIRMED')
    .eq('data->>bookingId', booking.bookingId);
  check(
    'exactly one payment-confirmed notification for this booking',
    notes?.length === 1,
    `${notes?.length}`,
  );
}

// ---------------------------------------------------------------------------
console.log('\nAfter payment');
// ---------------------------------------------------------------------------
{
  const got = await invoke('get-payment', { reference: payment.reference, token });
  check('the page now shows PAID', got.body?.data?.paymentStatus === 'PAID');
  check('and carries the receipt', Boolean(got.body?.data?.receipt?.receiptNumber));

  const cancelPaid = await passenger.supabase.rpc('cancel_booking', {
    p_booking_id: booking.bookingId,
  });
  check(
    'a paid booking cannot be cancelled through the pending-only path',
    cancelPaid.error?.message === 'BOOKING_ALREADY_CONFIRMED',
    cancelPaid.error?.message ?? 'the call succeeded',
  );

  const refund = await passenger.supabase.rpc('refund_test_payment', {
    p_booking_id: booking.bookingId,
  });
  check('a mock refund succeeds', !refund.error, refund.error?.message);
  check('the refund is not flagged as a repeat', refund.data?.alreadyRefunded === false);

  const again = await passenger.supabase.rpc('refund_test_payment', {
    p_booking_id: booking.bookingId,
  });
  check('refunding twice is idempotent', again.data?.alreadyRefunded === true, again.error?.message);

  const { data: seats } = await admin.supabase
    .from('trip_seats')
    .select('status')
    .eq('booking_id', booking.bookingId);
  check('a refund releases the seats', (seats?.length ?? 0) === 0, `${seats?.length} still linked`);
}

// ---------------------------------------------------------------------------
console.log('\nExpiry');
// ---------------------------------------------------------------------------
{
  const { booking: expiring } = await freshBooking(passenger.supabase, 1);
  const made = await invoke(
    'create-test-payment',
    { bookingId: expiring.bookingId },
    passenger.accessToken,
  );
  const expReference = made.body.data.reference;
  const expToken = new URL(made.body.data.paymentUrl).searchParams.get('t');

  // A client cannot write `payments` at all — that is the whole design — so
  // the only way to reach the expired path is to move the clock in the
  // database. Waiting ten real minutes would make this suite unusable.
  const sql =
    `update public.payments set expires_at = now() - interval '1 minute' ` +
    `where reference = '${expReference}'; ` +
    `update public.bookings set expires_at = now() - interval '1 minute' ` +
    `where id = (select booking_id from public.payments where reference = '${expReference}');`;

  execSync(`docker exec supabase_db_palago-app psql -U postgres -d postgres -c "${sql}"`, {
    stdio: 'pipe',
  });

  const confirmExpired = await invoke('confirm-test-payment', {
    reference: expReference,
    token: expToken,
  });
  check(
    'an expired payment cannot be confirmed',
    confirmExpired.body?.code === 'PAYMENT_EXPIRED' ||
      confirmExpired.body?.code === 'BOOKING_EXPIRED',
    confirmExpired.body?.code,
  );

  const { data: stillUnpaid } = await admin.supabase
    .from('payments')
    .select('status')
    .eq('reference', expReference)
    .single();
  check('and it remains unpaid', stillUnpaid?.status !== 'PAID', stillUnpaid?.status);

  const got = await invoke('get-payment', { reference: expReference, token: expToken });
  check('the payment page reports it as expired', got.body?.data?.isExpired === true);
}

await releaseAllHolds();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
