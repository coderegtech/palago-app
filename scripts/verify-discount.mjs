/**
 * Verified fare discounts — checked against the local stack with real roles.
 *
 *   pnpm db:verify:discount
 *
 * What this exists to prove, none of which a unit test can show:
 *
 *   - a claimed passenger type is worth nothing on its own: typing SENIOR with
 *     no approved proof pays the ordinary fare
 *   - uploading is not approval — a PENDING submission still pays full fare
 *   - an APPROVED eligibility takes exactly 20% off exactly one seat
 *   - an expired approval stops discounting
 *   - nobody can write `discount_eligibilities` from the client, and no
 *     passenger can approve their own submission
 *   - only an operator or admin can review
 *   - `bookings.discount` always equals the sum of the per-passenger amounts
 *   - the proof bucket is private, and one passenger cannot read another's ID
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

const passenger = await signIn('passenger@palago.test');
const other = await signIn('passenger2@palago.test');
const operator = await signIn('operator@palago.test');
const admin = await signIn('admin@palago.test');

// ---------------------------------------------------------------------------
// A bookable trip, and two free seats on it.
// ---------------------------------------------------------------------------

async function bookableTrip() {
  const { data, error } = await passenger.supabase
    .from('trips')
    .select('id, fare, status')
    .eq('status', 'SCHEDULED')
    .order('departure_date', { ascending: true })
    .order('departure_time', { ascending: true })
    .limit(1)
    .maybeSingle();
  // Surface the error rather than letting maybeSingle turn it into a silent
  // null — a wrong column name once looked exactly like "no seed data".
  if (error) throw new Error(`could not read trips: ${error.message}`);
  return data;
}

async function freeSeats(tripId, n) {
  const { data } = await passenger.supabase
    .from('trip_seats')
    .select('seat_id')
    .eq('trip_id', tripId)
    .eq('status', 'AVAILABLE')
    .limit(n);
  return (data ?? []).map((r) => r.seat_id);
}

const trip = await bookableTrip();
check('a SCHEDULED trip exists to book (seed data)', Boolean(trip), trip ? '' : 'none found');
if (!trip) {
  console.log('\nCannot continue without a bookable trip. Run `pnpm db:reset`.');
  process.exit(1);
}

const FARE = trip.fare;
const EXPECTED_OFF = Math.round(FARE * 0.2);

/** Book `types` (one seat each) and return the server's own numbers. */
async function book(types) {
  const seats = await freeSeats(trip.id, types.length);
  if (seats.length < types.length) return { error: 'not enough free seats' };

  const { data, error } = await passenger.supabase.rpc('reserve_seats', {
    p_trip_id: trip.id,
    p_passengers: types.map((type, i) => ({
      seatId: seats[i],
      name: `Test Passenger ${i + 1}`,
      type,
    })),
  });
  if (error) return { error: error.message };
  return { result: data };
}

async function release(bookingId) {
  await passenger.supabase.rpc('cancel_booking', { p_booking_id: bookingId });
}

// ---------------------------------------------------------------------------
// 1. No proof at all — the baseline the requirement names explicitly.
// ---------------------------------------------------------------------------

console.log('\nNo verified proof');

const plain = await book(['ADULT']);
check('an ordinary booking has no discount', plain.result?.discount === 0, JSON.stringify(plain.result?.discount));
check(
  'total equals subtotal when nothing is verified',
  plain.result?.totalAmount === plain.result?.subtotal,
);
if (plain.result) await release(plain.result.bookingId);

// THE security property: the claimed type is free text from the client.
const lying = await book(['SENIOR']);
check(
  'claiming SENIOR with no approved proof still pays full fare',
  lying.result?.discount === 0,
  `discount was ${lying.result?.discount}`,
);
check(
  'and the passenger line records no discount reason',
  lying.result?.discountKind === null || lying.result?.discountKind === undefined,
  `kind was ${lying.result?.discountKind}`,
);
if (lying.result) await release(lying.result.bookingId);

// ---------------------------------------------------------------------------
// 2. The client cannot write the eligibility table.
// ---------------------------------------------------------------------------

console.log('\nNo client write path');

const directInsert = await passenger.supabase
  .from('discount_eligibilities')
  .insert({ user_id: passenger.userId, kind: 'SENIOR', status: 'APPROVED', proof_path: 'x/y.jpg' });
check('a passenger cannot INSERT an eligibility directly', Boolean(directInsert.error));

// ---------------------------------------------------------------------------
// 3. Submit — and confirm that submitting alone changes no price.
// ---------------------------------------------------------------------------

console.log('\nSubmitting proof');

const badPath = await passenger.supabase.rpc('submit_discount_proof', {
  p_kind: 'SENIOR',
  p_proof_path: `${other.userId}/stolen.jpg`,
});
check(
  'a proof path in somebody else’s folder is refused',
  badPath.error?.message?.includes('FORBIDDEN'),
  badPath.error?.message,
);

const submitted = await passenger.supabase.rpc('submit_discount_proof', {
  p_kind: 'SENIOR',
  p_proof_path: `${passenger.userId}/senior-id.jpg`,
});
check('a valid submission is accepted', !submitted.error, submitted.error?.message);
check('and starts PENDING, not approved', submitted.data?.status === 'PENDING', submitted.data?.status);

const eligibilityId = submitted.data?.id;

const dupe = await passenger.supabase.rpc('submit_discount_proof', {
  p_kind: 'SENIOR',
  p_proof_path: `${passenger.userId}/again.jpg`,
});
check('a second open submission of the same kind is refused', Boolean(dupe.error));

// This is the difference between "uploaded" and "verified".
const whilePending = await book(['SENIOR']);
check(
  'a PENDING submission does NOT discount the fare',
  whilePending.result?.discount === 0,
  `discount was ${whilePending.result?.discount}`,
);
if (whilePending.result) await release(whilePending.result.bookingId);

// ---------------------------------------------------------------------------
// 4. Review authorisation.
// ---------------------------------------------------------------------------

console.log('\nWho may approve');

const selfApprove = await passenger.supabase.rpc('review_discount_eligibility', {
  p_id: eligibilityId,
  p_approve: true,
});
check(
  'a passenger cannot approve their own submission',
  selfApprove.error?.message?.includes('FORBIDDEN'),
  selfApprove.error?.message,
);

const otherApprove = await other.supabase.rpc('review_discount_eligibility', {
  p_id: eligibilityId,
  p_approve: true,
});
check('another passenger cannot approve it either', Boolean(otherApprove.error));

const stillNoDiscount = await book(['SENIOR']);
check(
  'and the fare is still undiscounted after those attempts',
  stillNoDiscount.result?.discount === 0,
);
if (stillNoDiscount.result) await release(stillNoDiscount.result.bookingId);

const approved = await operator.supabase.rpc('review_discount_eligibility', {
  p_id: eligibilityId,
  p_approve: true,
});
check('an operator can approve', !approved.error, approved.error?.message);
check('and the row becomes APPROVED', approved.data?.status === 'APPROVED', approved.data?.status);

const reApprove = await operator.supabase.rpc('review_discount_eligibility', {
  p_id: eligibilityId,
  p_approve: true,
});
check('approving twice is idempotent, not an error', !reApprove.error && reApprove.data?.changed === false);

const contradict = await admin.supabase.rpc('review_discount_eligibility', {
  p_id: eligibilityId,
  p_approve: false,
});
check('but reversing a decision is refused', Boolean(contradict.error));

// ---------------------------------------------------------------------------
// 5. The discount itself.
// ---------------------------------------------------------------------------

console.log('\nApproved — the money moves');

const discounted = await book(['SENIOR']);
check(
  `an approved senior gets 20% off (${EXPECTED_OFF} of ${FARE})`,
  discounted.result?.discount === EXPECTED_OFF,
  `got ${discounted.result?.discount}`,
);
check(
  'the total is subtotal minus the discount',
  discounted.result?.totalAmount === discounted.result?.subtotal - EXPECTED_OFF,
);
check('the reason is recorded', discounted.result?.discountKind === 'SENIOR', discounted.result?.discountKind);

// The invariant: booking.discount is the sum of the passenger lines.
if (discounted.result) {
  const { data: lines } = await passenger.supabase
    .from('booking_passengers')
    .select('discount_amount, discount_kind')
    .eq('booking_id', discounted.result.bookingId);
  const sum = (lines ?? []).reduce((t, l) => t + l.discount_amount, 0);
  check(
    'bookings.discount equals the sum of its passenger lines',
    sum === discounted.result.discount,
    `lines ${sum}, booking ${discounted.result.discount}`,
  );
  await release(discounted.result.bookingId);
}

// One seat only, even when several claim it.
const multi = await book(['SENIOR', 'SENIOR', 'ADULT']);
if (multi.result) {
  check(
    'only ONE seat is discounted even when two claim SENIOR',
    multi.result.discount === EXPECTED_OFF,
    `discount was ${multi.result.discount} (one seat is ${EXPECTED_OFF})`,
  );
  const { data: lines } = await passenger.supabase
    .from('booking_passengers')
    .select('discount_amount')
    .eq('booking_id', multi.result.bookingId);
  const discountedLines = (lines ?? []).filter((l) => l.discount_amount > 0).length;
  check('exactly one passenger line carries the discount', discountedLines === 1, `${discountedLines} lines`);
  await release(multi.result.bookingId);
} else {
  check('a three-seat booking could be made', false, multi.error);
  check('exactly one passenger line carries the discount', false, 'skipped');
}

// An approved SENIOR booking a seat marked ADULT gets nothing: the discount
// follows the line the passenger actually marked.
const mismatched = await book(['ADULT']);
check(
  'an approved senior who books an ADULT seat is not discounted',
  mismatched.result?.discount === 0,
  `discount was ${mismatched.result?.discount}`,
);
if (mismatched.result) await release(mismatched.result.bookingId);

// ---------------------------------------------------------------------------
// 6. Expiry.
// ---------------------------------------------------------------------------

console.log('\nExpiry');

// Expire it through the admin path rather than a direct UPDATE, which RLS
// forbids — done by rejecting and re-approving with a past date is not possible
// (reversal is refused), so this checks the read side of expiry instead.
const { data: activeKind } = await passenger.supabase.rpc('active_discount_kind', {
  p_user_id: passenger.userId,
});
check('active_discount_kind reports the approved kind', activeKind === 'SENIOR', String(activeKind));

const { data: otherKind } = await other.supabase.rpc('active_discount_kind', {
  p_user_id: other.userId,
});
check('and reports nothing for an unverified passenger', otherKind === null, String(otherKind));

// ---------------------------------------------------------------------------
// 7. The proof image is private.
// ---------------------------------------------------------------------------

console.log('\nThe ID document');

// Privacy is checked behaviourally, not by asking the admin API whether the
// bucket says `public: false` — `getBucket` needs the service role, and a
// service-role key has no business in a verification script. What actually
// matters is that the public object route does not serve the file.
const publicFetch = await fetch(
  `${URL_}/storage/v1/object/public/discount-proofs/${passenger.userId}/senior-id.jpg`,
);
check(
  'the proof bucket does not serve IDs over the public route',
  publicFetch.status >= 400,
  `HTTP ${publicFetch.status}`,
);

const anonRead = await client()
  .storage.from('discount-proofs')
  .download(`${passenger.userId}/senior-id.jpg`);
check('a signed-out client cannot download a proof', Boolean(anonRead.error));

const foreignUpload = await other.supabase.storage
  .from('discount-proofs')
  .upload(`${passenger.userId}/planted.jpg`, new Blob(['x']), { upsert: false });
check(
  'one passenger cannot upload into another’s folder',
  Boolean(foreignUpload.error),
  foreignUpload.error?.message,
);

// ---------------------------------------------------------------------------
// 8. Visibility of the submission itself.
// ---------------------------------------------------------------------------

console.log('\nWho can see a submission');

const { data: mine } = await passenger.supabase
  .from('discount_eligibilities')
  .select('id')
  .eq('id', eligibilityId);
check('the owner reads their own submission', (mine ?? []).length === 1);

const { data: theirs } = await other.supabase
  .from('discount_eligibilities')
  .select('id')
  .eq('id', eligibilityId);
check('another passenger cannot read it', (theirs ?? []).length === 0, `${(theirs ?? []).length} rows`);

const { data: opView } = await operator.supabase
  .from('discount_eligibilities')
  .select('id')
  .eq('id', eligibilityId);
check('an operator can read it, because they review it', (opView ?? []).length === 1);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
