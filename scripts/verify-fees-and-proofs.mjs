/**
 * The ₱10 convenience fee, ID photos per passenger, and the booking QR —
 * verified against the local stack with real signed-in roles.
 *
 *   pnpm db:verify:fees
 *
 * The eight scenarios of the specification, plus what makes them safe:
 *
 *   1. a regular passenger — no photo asked, fare + ₱10
 *   2. a student with an ID photo — 20% off the fare, fee untouched
 *   3. a senior with an ID photo — the same
 *   4. booking on behalf of someone else — the booker's account, the other
 *      person's discount, the other person's photo
 *   5–6. the payment QR and the booking QR exist, are unique, and only the
 *      people entitled to them can obtain them
 *   7. the fee is on the booking, the payment and the receipt, and in the amount
 *   8. discount + fee together, and a reward + fee
 *
 *   and: a photo must be the booker's own upload, present, and an image; it
 *   only counts on a senior/student/PWD line; only the uploader, the booking,
 *   the trip's crew and managers and admins can read it; the door flags the
 *   passenger for an ID check; loyalty points are for the fare, not the fee;
 *   counter sales carry the fee too.
 */

import { createClient } from '@supabase/supabase-js';

import { loadVerifyEnv } from './_verify-env.mjs';
import { makeInvoke } from './_verify-invoke.mjs';

const { url: URL_, key: KEY } = loadVerifyEnv();
const PASSWORD = 'PalawanGo2026';
const FEE = 1_000;
const RATE_BPS = 2_000;
const BUCKET = 'passenger-proofs';

const invoke = makeInvoke(URL_, KEY);
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

const passenger = await signIn('passenger@palago.test');
const other = await signIn('passenger2@palago.test');
const cherry = await signIn('operator@palago.test');
const roro = await signIn('roro@palago.test');
const admin = await signIn('admin@palago.test');
const anon = client();

// A real 1×1 PNG, so the bucket's own MIME check is exercised, not bypassed.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);
const RUN = Date.now().toString(36);
let uploads = 0;

async function uploadProof(session, { bytes = PNG, contentType = 'image/png', folder } = {}) {
  const path = `${folder ?? session.userId}/verify-${RUN}-${(uploads += 1)}.png`;
  const { error } = await session.supabase.storage.from(BUCKET).upload(path, bytes, { contentType });
  return { path, error };
}

// A Cherry trip open for sale, well in the future, that the operator can scan.
const { data: trips } = await passenger.supabase
  .from('trip_search')
  .select('id, fare, operator_name')
  .eq('status', 'SCHEDULED')
  .order('departure_date', { ascending: false })
  .limit(20);
const trip = trips?.find((t) => /cherry/i.test(t.operator_name ?? '')) ?? trips?.[0];
if (!trip) throw new Error('No SCHEDULED trip in the seed.');
const OFF = Math.round((trip.fare * RATE_BPS) / 10_000);

async function book(session, passengers) {
  return session.supabase.rpc('create_booking', { p_trip_id: trip.id, p_passengers: passengers });
}

async function bookingRow(bookingId) {
  const { data } = await admin.supabase
    .from('bookings')
    .select('subtotal, discount, loyalty_discount, convenience_fee, total_amount, user_id, created_by')
    .eq('id', bookingId)
    .single();
  return data;
}

async function payByQr(session, bookingId) {
  const created = await invoke('create-test-payment', { bookingId }, session.accessToken);
  const paymentUrl = created.body?.data?.paymentUrl;
  const token = paymentUrl ? new URL(paymentUrl).searchParams.get('t') : null;
  const confirmed = await invoke('confirm-test-payment', { reference: created.body?.data?.reference, token });
  return { created: created.body, confirmed: confirmed.body, token };
}

async function paymentAndReceipt(bookingId) {
  const { data: payment } = await admin.supabase
    .from('payments')
    .select('id, amount, convenience_fee, status')
    .eq('booking_id', bookingId)
    .eq('status', 'PAID')
    .single();
  const { data: receipt } = await admin.supabase
    .from('receipts')
    .select('amount, convenience_fee')
    .eq('booking_id', bookingId)
    .maybeSingle();
  return { payment, receipt };
}

// ---------------------------------------------------------------------------
console.log('\n1 & 7. A regular passenger: no photo, fare + ₱10');
// ---------------------------------------------------------------------------

const regular = await book(passenger, [{ name: 'Juan Dela Cruz', type: 'ADULT' }]);
check('a regular booking needs no photo', !regular.error, regular.error?.message);
check(
  'it costs the fare plus the ₱10 convenience fee',
  regular.data?.totalAmount === trip.fare + FEE && regular.data?.convenienceFee === FEE,
  JSON.stringify(regular.data),
);
{
  const row = await bookingRow(regular.data.bookingId);
  check('the fee is stored on the booking', row?.convenience_fee === FEE, JSON.stringify(row));
  check(
    'and the total adds up: fare − discount − reward + fee',
    row.total_amount === row.subtotal - row.discount - row.loyalty_discount + row.convenience_fee,
  );

  const paid = await payByQr(passenger, regular.data.bookingId);
  check('it can be paid', paid.confirmed?.success === true, JSON.stringify(paid.confirmed));
  check('the passenger pays the fee', paid.created?.data?.amount === trip.fare + FEE, `${paid.created?.data?.amount}`);

  const { payment, receipt } = await paymentAndReceipt(regular.data.bookingId);
  check('the payment records the fee separately', payment?.convenience_fee === FEE, JSON.stringify(payment));
  check('the receipt records it too', receipt?.convenience_fee === FEE && receipt?.amount === trip.fare + FEE, JSON.stringify(receipt));

  // The public payment page shows the fee as its own line.
  const page = await invoke('get-payment', {
    reference: paid.created?.data?.reference,
    token: paid.token,
  });
  check('the payment page shows the fee', page.body?.data?.convenienceFee === FEE, JSON.stringify(page.body?.data?.convenienceFee));

  // Loyalty is for the fare, not the fee.
  const { data: earned } = await passenger.supabase
    .from('loyalty_transactions')
    .select('points')
    .eq('booking_id', regular.data.bookingId)
    .eq('type', 'EARNED')
    .maybeSingle();
  check(
    'loyalty points are counted on the fare, not the fee',
    (earned?.points ?? 0) === Math.floor(trip.fare / 10_000),
    `${earned?.points} for a ₱${trip.fare / 100} fare`,
  );
}

// ---------------------------------------------------------------------------
console.log('\n2, 3 & 8. A student and a senior with ID photos: 20% off, fee untouched');
// ---------------------------------------------------------------------------

for (const type of ['STUDENT', 'SENIOR']) {
  const photo = await uploadProof(passenger);
  check(`a ${type.toLowerCase()} ID photo uploads to the booker's own folder`, !photo.error, photo.error?.message);

  const res = await book(passenger, [{ name: `Photo ${type}`, type, proofPath: photo.path }]);
  check(`a ${type.toLowerCase()} booking with a photo is accepted`, !res.error, res.error?.message);
  check(
    `it is discounted 20% of the fare (${OFF / 100}) and still pays the ₱10 fee`,
    res.data?.discount === OFF && res.data?.totalAmount === trip.fare - OFF + FEE,
    JSON.stringify(res.data),
  );

  const { data: line } = await admin.supabase
    .from('booking_passengers')
    .select('passenger_type, discount_kind, discount_amount, proof_path')
    .eq('booking_id', res.data?.bookingId)
    .single();
  check(
    'the photo is stored against that passenger on that booking',
    line?.proof_path === photo.path && line?.discount_kind === type && line?.discount_amount === OFF,
    JSON.stringify(line),
  );

  const paid = await payByQr(passenger, res.data.bookingId);
  const { payment } = await paymentAndReceipt(res.data.bookingId);
  check(
    'discount + fee: the payment is fare − 20% + ₱10',
    paid.confirmed?.success === true && payment?.amount === trip.fare - OFF + FEE && payment?.convenience_fee === FEE,
    JSON.stringify(payment),
  );
}

// ---------------------------------------------------------------------------
console.log('\n4. Booking on behalf of someone else');
// ---------------------------------------------------------------------------

let behalfBooking = null;
let behalfPhoto = null;
{
  // Person A (passenger2) books for themselves and for Person B, a student.
  behalfPhoto = await uploadProof(other);
  const res = await book(other, [
    { name: 'Ana Villanueva', type: 'ADULT' },
    { name: 'Miguel Reyes', type: 'STUDENT', proofPath: behalfPhoto.path },
  ]);
  behalfBooking = res.data;
  check('a booking for another person, with their student ID, is accepted', !res.error, res.error?.message);
  check(
    'only the student is discounted, and the fee is charged once',
    res.data?.subtotal === trip.fare * 2 && res.data?.discount === OFF && res.data?.totalAmount === trip.fare * 2 - OFF + FEE,
    JSON.stringify(res.data),
  );
  const row = await bookingRow(res.data?.bookingId);
  check('the booking belongs to the person who booked it', row?.user_id === other.userId && row?.created_by === other.userId);

  const { data: lines } = await admin.supabase
    .from('booking_passengers')
    .select('passenger_name, proof_path')
    .eq('booking_id', res.data?.bookingId);
  check(
    "the photo is on the student's line, not the booker's",
    lines?.find((l) => l.passenger_name === 'Miguel Reyes')?.proof_path === behalfPhoto.path &&
      !lines?.find((l) => l.passenger_name === 'Ana Villanueva')?.proof_path,
    JSON.stringify(lines),
  );

  const paid = await payByQr(other, res.data.bookingId);
  check('it can be paid', paid.confirmed?.success === true, JSON.stringify(paid.confirmed));
}

// ---------------------------------------------------------------------------
console.log('\nA photo must be the booker’s own, present, and an image');
// ---------------------------------------------------------------------------

async function bookingCount(session) {
  const { count } = await session.supabase.from('bookings').select('id', { count: 'exact', head: true });
  return count;
}

{
  const before = await bookingCount(passenger);

  // passenger2's photo, named by passenger.
  const stolen = await book(passenger, [{ name: 'Not Mine', type: 'STUDENT', proofPath: behalfPhoto.path }]);
  check("someone else's photo is refused", stolen.error?.message === 'FORBIDDEN', stolen.error?.message);

  const missing = await book(passenger, [
    { name: 'No File', type: 'STUDENT', proofPath: `${passenger.userId}/does-not-exist-${RUN}.png` },
  ]);
  check('a photo that was never uploaded is refused', missing.error?.message === 'VALIDATION_ERROR', missing.error?.message);

  const photo = await uploadProof(passenger);
  const onAdult = await book(passenger, [{ name: 'Adult With Photo', type: 'ADULT', proofPath: photo.path }]);
  check('a photo on a regular adult line is refused', onAdult.error?.message === 'VALIDATION_ERROR', onAdult.error?.message);

  const traversal = await book(passenger, [{ name: 'Sneaky', type: 'STUDENT', proofPath: `${passenger.userId}/../x.png` }]);
  check('a malformed path is refused', Boolean(traversal.error), traversal.error?.message);

  check('none of the refusals created a booking', (await bookingCount(passenger)) === before, `${before} → ${await bookingCount(passenger)}`);

  const noPhoto = await book(passenger, [{ name: 'Claims Student', type: 'STUDENT' }]);
  check(
    'claiming STUDENT with no photo and no verified account gives no discount',
    !noPhoto.error && noPhoto.data?.discount === 0 && noPhoto.data?.totalAmount === trip.fare + FEE,
    JSON.stringify(noPhoto.data ?? noPhoto.error),
  );

  const text = await uploadProof(passenger, {
    bytes: new TextEncoder().encode('not an image'),
    contentType: 'text/plain',
  });
  check('the bucket refuses a file that is not an image', Boolean(text.error), 'a text file uploaded');

  const foreign = await uploadProof(passenger, { folder: other.userId });
  check("nobody can upload into another person's folder", Boolean(foreign.error), 'the upload succeeded');

  const anonUpload = await anon.storage.from(BUCKET).upload(`${passenger.userId}/anon-${RUN}.png`, PNG, { contentType: 'image/png' });
  check('an anonymous caller cannot upload', Boolean(anonUpload.error));
}

// ---------------------------------------------------------------------------
console.log('\nWho can see a passenger’s ID photo');
// ---------------------------------------------------------------------------

async function canRead(session, path) {
  const { data, error } = await session.storage.from(BUCKET).createSignedUrl(path, 60);
  return !error && Boolean(data?.signedUrl);
}

check('the person who uploaded it', await canRead(other.supabase, behalfPhoto.path));
check("the booking's operator, whose crew check it at the door", await canRead(cherry.supabase, behalfPhoto.path));
check('an admin', await canRead(admin.supabase, behalfPhoto.path));
check('NOT another passenger', !(await canRead(passenger.supabase, behalfPhoto.path)));
check('NOT a rival operator', !(await canRead(roro.supabase, behalfPhoto.path)));
check('NOT an anonymous caller', !(await canRead(anon, behalfPhoto.path)));

// ---------------------------------------------------------------------------
console.log('\n5 & 6. The QR codes: unique, and only for those entitled');
// ---------------------------------------------------------------------------

{
  const pass = await invoke('get-boarding-pass', { bookingId: behalfBooking.bookingId }, other.accessToken);
  check('the booker gets the booking QR', pass.body?.success === true, JSON.stringify(pass.body));
  check(
    'it identifies this booking by id and reference',
    pass.body?.data?.bookingId === behalfBooking.bookingId && pass.body?.data?.reference === behalfBooking.reference,
  );

  const stranger = await invoke('get-boarding-pass', { bookingId: behalfBooking.bookingId }, passenger.accessToken);
  check("another passenger cannot get someone else's booking QR", stranger.body?.success !== true, JSON.stringify(stranger.body));

  const nobody = await invoke('get-boarding-pass', { bookingId: behalfBooking.bookingId });
  check('an anonymous caller cannot either', nobody.body?.success !== true);

  const otherPass = await invoke('get-boarding-pass', { bookingId: regular.data.bookingId }, passenger.accessToken);
  check(
    'each booking has its own QR',
    otherPass.body?.data?.token && otherPass.body.data.token !== pass.body?.data?.token,
  );

  // The door: the student is flagged for an ID check, with the photo to compare.
  const payload = JSON.stringify({
    type: 'PALAGO_BOOKING',
    bookingId: pass.body.data.bookingId,
    reference: pass.body.data.reference,
    token: pass.body.data.token,
  });
  const scan = await invoke('validate-qr', { payload, tripId: trip.id }, cherry.accessToken);
  const scanned = scan.body?.data?.passengers ?? [];
  const student = scanned.find((p) => p.name === 'Miguel Reyes');
  const adult = scanned.find((p) => p.name === 'Ana Villanueva');
  check('the door scan tells the crew to check the student’s ID', student?.idCheck === true, JSON.stringify(student));
  check('with the photo that was attached', student?.proofPath === behalfPhoto.path);
  check('and does not flag the regular passenger', adult?.idCheck === false, JSON.stringify(adult));

  // The payment QR is a link carrying a per-payment token; a wrong token reads nothing.
  const created = await invoke('create-test-payment', { bookingId: (await book(passenger, [{ name: 'QR', type: 'ADULT' }])).data.bookingId }, passenger.accessToken);
  const url = new URL(created.body?.data?.paymentUrl);
  check('the payment QR carries its own token', (url.searchParams.get('t') ?? '').length >= 32);
  const wrong = await invoke('get-payment', { reference: created.body?.data?.reference, token: 'f'.repeat(64) });
  check('and a guessed token opens nothing', wrong.body?.success !== true);
}

// ---------------------------------------------------------------------------
console.log('\n8. A reward and the fee');
// ---------------------------------------------------------------------------

{
  // The seed's bonus went on the seed's own redemption, so earn the points the
  // honest way: one paid party of ten is ten fares' worth of points.
  const { data: reward } = await other.supabase
    .from('rewards')
    .select('id, discount_value, points_required')
    .eq('code', 'FIFTY_OFF')
    .single();
  const { data: account } = await other.supabase.from('loyalty_accounts').select('points_balance').single();
  if ((account?.points_balance ?? 0) < reward.points_required) {
    const party = await book(
      other,
      Array.from({ length: 10 }, (_unused, i) => ({ name: `Party ${i + 1}`, type: 'ADULT' })),
    );
    await payByQr(other, party.data.bookingId);
  }
  const res = await book(other, [{ name: 'Reward Ride', type: 'ADULT' }]);
  const redeemed = await other.supabase.rpc('redeem_reward', { p_booking_id: res.data.bookingId, p_reward_id: reward.id });
  if (redeemed.error) {
    check('a reward can be applied for this test', false, redeemed.error.message);
  } else {
    const row = await bookingRow(res.data.bookingId);
    check(
      'a reward comes off the fare and the ₱10 fee stays',
      row.loyalty_discount === reward.discount_value && row.total_amount === trip.fare - reward.discount_value + FEE,
      JSON.stringify(row),
    );
    await other.supabase.rpc('cancel_reward_redemption', { p_booking_id: res.data.bookingId });
    const restored = await bookingRow(res.data.bookingId);
    check('removing the reward restores fare + fee', restored.total_amount === trip.fare + FEE, JSON.stringify(restored));
  }
}

// ---------------------------------------------------------------------------
console.log('\nEvery way of paying carries the fee');
// ---------------------------------------------------------------------------

{
  const res = await book(other, [{ name: 'Wallet Ride', type: 'ADULT' }]);
  await other.supabase.rpc('top_up_wallet', { p_amount: res.data.totalAmount, p_idempotency_key: `fee-${RUN}` });
  const paid = await other.supabase.rpc('pay_booking_with_wallet', { p_booking_id: res.data.bookingId });
  const { payment, receipt } = await paymentAndReceipt(res.data.bookingId);
  check(
    'a wallet payment is fare + fee, with the fee recorded',
    !paid.error && payment?.amount === trip.fare + FEE && payment?.convenience_fee === FEE && receipt?.convenience_fee === FEE,
    paid.error?.message ?? JSON.stringify(payment),
  );
}

{
  // A walk-in at the Cherry counter, a senior with an ID photo taken by the clerk.
  const photo = await uploadProof(cherry);
  const { data: seats } = await cherry.supabase
    .from('trip_seats')
    .select('seat_id')
    .eq('trip_id', trip.id)
    .eq('status', 'AVAILABLE')
    .limit(1);
  const sale = await cherry.supabase.rpc('create_booking', {
    p_trip_id: trip.id,
    p_passengers: [{ name: 'Lola Remedios', type: 'SENIOR', proofPath: photo.path }],
    p_seat_ids: seats?.map((s) => s.seat_id) ?? [],
    p_walk_in: true,
    p_source: 'OPERATOR',
    p_ticket_type: 'PRINTED',
  });
  check(
    'a counter sale carries the fee, and a walk-in senior with a photo is discounted',
    !sale.error && sale.data?.totalAmount === trip.fare - OFF + FEE,
    sale.error?.message ?? JSON.stringify(sale.data),
  );
  const cash = await cherry.supabase.rpc('record_counter_payment', { p_booking_id: sale.data?.bookingId, p_method: 'CASH' });
  const { payment } = await paymentAndReceipt(sale.data?.bookingId);
  check('the cash taken is that amount, fee included', !cash.error && payment?.amount === trip.fare - OFF + FEE && payment?.convenience_fee === FEE, cash.error?.message ?? JSON.stringify(payment));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
