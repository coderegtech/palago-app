/**
 * The admin data reset: who can press it, what it takes, what it leaves.
 *
 *   pnpm db:verify:reset
 *
 * DESTRUCTIVE. It empties the local database's transactional data, which every
 * other suite depends on — so it runs LAST in `db:verify:all`, and a
 * `pnpm db:reset` puts the seed back afterwards. `_verify-env.mjs` keeps it off
 * any hosted project; there is no override for this one worth having.
 *
 * What it proves, in the order that matters:
 *
 *   1. Nobody but a SUPER_ADMIN can run it, and a wrong or missing phrase is
 *      refused — asserted by counting rows before and after, not by reading
 *      the error, because a refusal that quietly deleted something would pass
 *      an error-message check.
 *   2. It takes exactly what it says: every transactional table empty,
 *      passenger accounts gone and unable to sign in, the ID photograph gone
 *      from Storage and not merely its row.
 *   3. It leaves exactly what it says: admin, staff and the test account can
 *      sign in; operators, terminals, routes, coaches, trips and the rewards
 *      catalogue are untouched; "not for sale" seats are still not for sale.
 *   4. It starts clean: the test account has no history and a zero balance,
 *      the wallet invariant holds, and the next booking is number 000001.
 *   5. It leaves a record of who did it.
 */

import { createClient } from '@supabase/supabase-js';

import { loadVerifyEnv } from './_verify-env.mjs';
import { makeInvoke } from './_verify-invoke.mjs';

const { url: URL_, key: KEY } = loadVerifyEnv();
const PASSWORD = 'PalawanGo2026';
const invoke = makeInvoke(URL_, KEY);

const client = () => createClient(URL_, KEY, { auth: { persistSession: false } });

async function signIn(email) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) return { error };
  return { supabase, email, userId: data.user.id, accessToken: data.session.access_token };
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

const admin = await signIn('admin@palago.test');
const operator = await signIn('operator@palago.test');
const driver = await signIn('driver@palago.test');
const passenger = await signIn('passenger@palago.test'); // the test account
const passenger2 = await signIn('passenger2@palago.test'); // an ordinary passenger

/** Row counts the admin can see, through the preview — the thing being protected. */
async function counts() {
  const { data } = await admin.supabase.rpc('data_reset_preview');
  return data;
}

// ---------------------------------------------------------------------------
console.log('\nSetting the stage');
// ---------------------------------------------------------------------------

// A real ID photograph from an ordinary passenger, so the Storage half of the
// reset is exercised and not merely the database half.
const proofPath = `${passenger2.userId}/verify-reset-${Date.now().toString(36)}.png`;
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);
const upload = await passenger2.supabase.storage
  .from('discount-proofs')
  .upload(proofPath, png, { contentType: 'image/png' });
check('a passenger can upload an ID photograph', !upload.error, upload.error?.message);

const submitted = await passenger2.supabase.rpc('submit_discount_proof', {
  p_kind: 'STUDENT',
  p_proof_path: proofPath,
});
check('and submit it for a discount', !submitted.error, submitted.error?.message);

const before = await counts();
check(
  'there is demo data to reset',
  before?.delete?.bookings > 0 && before?.delete?.passengerAccounts > 0,
  JSON.stringify(before?.delete),
);
check('the seeded passenger is the test account', (before?.keep?.testAccountEmails ?? []).includes('passenger@palago.test'), JSON.stringify(before?.keep?.testAccountEmails));

const keptBefore = before?.keep ?? {};

// ---------------------------------------------------------------------------
console.log('\nOnly a SUPER_ADMIN, and only with the phrase');
// ---------------------------------------------------------------------------

for (const [who, session] of [
  ['an operator admin', operator],
  ['a driver', driver],
  ['a passenger', passenger],
]) {
  const res = await invoke('reset-data', { action: 'reset', confirmation: 'RESET DATABASE' }, session.accessToken);
  check(`${who} is refused`, res.body?.success === false, `${res.status} ${JSON.stringify(res.body)}`);

  const direct = await session.supabase.rpc('reset_application_data', { p_confirmation: 'RESET DATABASE' });
  check(`${who} is refused calling the database directly too`, Boolean(direct.error), 'the RPC ran');

  const preview = await session.supabase.rpc('data_reset_preview');
  check(`${who} cannot even see the preview`, Boolean(preview.error), 'the preview returned');
}

const anon = await invoke('reset-data', { action: 'reset', confirmation: 'RESET DATABASE' });
check('an anonymous caller is refused', anon.status === 401 || anon.body?.success === false, String(anon.status));

for (const phrase of ['', 'reset database', 'RESET DATABASE ', 'RESET', 'yes']) {
  const res = await invoke('reset-data', { action: 'reset', confirmation: phrase }, admin.accessToken);
  check(`the admin with "${phrase}" is refused`, res.body?.success === false, JSON.stringify(res.body));
}

// The effect, not the message: nothing moved.
const afterRefusals = await counts();
check(
  'and after every refusal, nothing was deleted',
  JSON.stringify(afterRefusals?.delete) === JSON.stringify(before?.delete),
  `${JSON.stringify(before?.delete)} -> ${JSON.stringify(afterRefusals?.delete)}`,
);

// ---------------------------------------------------------------------------
console.log('\nThe reset');
// ---------------------------------------------------------------------------

const preview = await invoke('reset-data', { action: 'preview' }, admin.accessToken);
check('the admin sees what would be deleted before confirming', preview.body?.data?.delete?.bookings === before.delete.bookings, JSON.stringify(preview.body));

const reset = await invoke('reset-data', { action: 'reset', confirmation: 'RESET DATABASE' }, admin.accessToken);
check('the admin with the exact phrase succeeds', reset.body?.success === true, JSON.stringify(reset.body));
check('and is told how much went', reset.body?.data?.deleted?.bookings === before.delete.bookings, JSON.stringify(reset.body?.data?.deleted));
check('and that the ID photograph was removed', reset.body?.data?.proofFiles?.removed >= 1 && reset.body?.data?.proofFiles?.failed === 0, JSON.stringify(reset.body?.data?.proofFiles));

// ---------------------------------------------------------------------------
console.log('\nWhat it took');
// ---------------------------------------------------------------------------

const after = await counts();
for (const [table, n] of Object.entries(after?.delete ?? {})) {
  check(`${table}: none left`, n === 0, String(n));
}

const gone = await signIn('passenger2@palago.test');
check('an ordinary passenger account is gone and cannot sign in', Boolean(gone.error), 'it signed in');

const stillThere = await admin.supabase.storage.from('discount-proofs').list(passenger2.userId);
check(
  'the ID photograph is gone from Storage, not just its row',
  !stillThere.error && (stillThere.data ?? []).length === 0,
  JSON.stringify(stillThere.data ?? stillThere.error),
);

// ---------------------------------------------------------------------------
console.log('\nWhat it left');
// ---------------------------------------------------------------------------

for (const email of ['admin@palago.test', 'operator@palago.test', 'driver@palago.test', 'passenger@palago.test']) {
  const s = await signIn(email);
  check(`${email} can still sign in`, !s.error, s.error?.message);
}

for (const key of ['superAdmins', 'staffAccounts', 'testAccounts', 'operators', 'terminals', 'routes', 'buses', 'trips', 'rewards']) {
  check(`${key} untouched`, after?.keep?.[key] === keptBefore[key], `${keptBefore[key]} -> ${after?.keep?.[key]}`);
}

// Seat state is only readable through the trip views; the admin reads the table.
const { data: seatStates } = await admin.supabase.from('trip_seats').select('status');
const byStatus = (seatStates ?? []).reduce((a, s) => ((a[s.status] = (a[s.status] ?? 0) + 1), a), {});
check('no seat is held or sold', !byStatus.HELD && !byStatus.BOOKED, JSON.stringify(byStatus));
check('"not for sale" seats are still not for sale', (byStatus.BLOCKED ?? 0) > 0, JSON.stringify(byStatus));

// ---------------------------------------------------------------------------
console.log('\nThe test account starts clean');
// ---------------------------------------------------------------------------

const t = await signIn('passenger@palago.test');
const { data: tp } = await t.supabase.from('profiles').select('is_test_account').eq('id', t.userId).single();
check('it is still marked as the test account', tp?.is_test_account === true, JSON.stringify(tp));

const { data: wallet } = await t.supabase.from('wallets').select('balance').eq('user_id', t.userId).single();
check('its wallet balance is zero', wallet?.balance === 0, JSON.stringify(wallet));

const { data: ledger } = await t.supabase.from('wallet_transactions').select('amount');
check('and its ledger is empty, so sum(amount) = balance still holds', (ledger ?? []).length === 0, String(ledger?.length));

const { data: loyalty } = await t.supabase.from('loyalty_accounts').select('points_balance, lifetime_points').eq('user_id', t.userId).single();
check('its points are zero', loyalty?.points_balance === 0 && loyalty?.lifetime_points === 0, JSON.stringify(loyalty));

const { data: myBookings } = await t.supabase.from('bookings').select('id');
check('it has no bookings', (myBookings ?? []).length === 0, String(myBookings?.length));

const { data: myNotes } = await t.supabase.from('notifications').select('id');
check('and no notifications', (myNotes ?? []).length === 0, String(myNotes?.length));

// Reference numbers restarted: the first booking after a reset is 000001.
const { data: trips } = await t.supabase
  .from('trip_search')
  .select('id')
  .in('status', ['SCHEDULED', 'BOARDING'])
  .eq('is_active', true)
  .gt('available_seats', 0)
  .limit(1);
const booked = await t.supabase.rpc('create_booking', {
  p_trip_id: trips?.[0]?.id,
  p_passengers: [{ name: 'Fresh Start', type: 'ADULT' }],
  p_seat_ids: null,
  p_walk_in: false,
  p_source: 'MOBILE_APP',
  p_ticket_type: 'DIGITAL',
});
const ref = booked.data?.reference ?? booked.data?.bookingReference ?? '';
check('the first booking after a reset is number 000001', /-000001$/.test(ref), ref || booked.error?.message);

// ---------------------------------------------------------------------------
console.log('\nThe record of it');
// ---------------------------------------------------------------------------

const { data: log } = await admin.supabase
  .from('audit_logs')
  .select('actor_user_id, action, metadata, created_at')
  .eq('action', 'DATA_RESET')
  .order('created_at', { ascending: false })
  .limit(1)
  .single();
check('the reset is in the audit log', Boolean(log), 'no DATA_RESET entry');
check('naming the admin who ran it', log?.actor_user_id === admin.userId, log?.actor_user_id);
check('with what it deleted', log?.metadata?.deleted?.bookings === before.delete.bookings, JSON.stringify(log?.metadata?.deleted));

console.log(`\n${passed} passed, ${failures.length} failed`);
console.log('\n  The local database is now empty of demo data. `pnpm db:reset` restores the seed.\n');
if (failures.length) {
  console.log('Failed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
