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
 *   2. It takes everything except the admins: every other account (passengers,
 *      operator admins, drivers, crew, the test account), every operator,
 *      terminal, route, coach, schedule and reward, every transaction, and the
 *      ID photograph from Storage rather than merely its row.
 *   3. It keeps the admins, the settings and the audit log.
 *   4. The empty platform is usable: an admin can enter an operator, terminals,
 *      a route, a coach and a trip from nothing, and the first booking on it is
 *      number 000001.
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

// A cash sale at the counter, taken by an operator who is about to be deleted.
// A CASH payment must name the clerk who took it, and deleting the clerk first
// would null `received_by` and fail the reset. The seed has no cash sale, so
// without this the suite passed on its own while the reset failed in the full
// sweep — after verify-counter had sold one.
const { data: sellable } = await operator.supabase
  .from('operator_trip_overview')
  .select('id, status, seats_available')
  .in('status', ['SCHEDULED', 'BOARDING'])
  .gt('seats_available', 0)
  .limit(1);
const walkIn = await operator.supabase.rpc('create_booking', {
  p_trip_id: sellable?.[0]?.id,
  p_passengers: [{ name: 'Walk-in Passenger', type: 'ADULT' }],
  p_seat_ids: null,
  p_walk_in: true,
  p_source: 'OPERATOR',
  p_ticket_type: 'PRINTED',
});
const walkInId = walkIn.data?.bookingId ?? walkIn.data?.id;
const cash = await operator.supabase.rpc('record_counter_payment', {
  p_booking_id: walkInId,
  p_method: 'CASH',
});
check('an operator sells a seat for cash before the reset', !walkIn.error && !cash.error, walkIn.error?.message ?? cash.error?.message);

const before = await counts();
check(
  'there is demo data to reset',
  before?.delete?.bookings > 0 && before?.delete?.accounts > 0 && before?.delete?.operators > 0,
  JSON.stringify(before?.delete),
);
check(
  'only the admin is listed as kept',
  JSON.stringify(before?.keep?.superAdminEmails) === JSON.stringify(['admin@palago.test']),
  JSON.stringify(before?.keep),
);

const turnaroundBefore = (await admin.supabase.rpc('public_setting', { p_key: 'trip_turnaround_minutes' })).data;


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

for (const email of [
  'passenger@palago.test',
  'passenger2@palago.test',
  'operator@palago.test',
  'roro@palago.test',
  'driver@palago.test',
  'assistant@palago.test',
]) {
  const s = await signIn(email);
  check(`${email} is gone and cannot sign in`, Boolean(s.error), 'it signed in');
}

const stillThere = await admin.supabase.storage.from('discount-proofs').list(passenger2.userId);
check(
  'the ID photograph is gone from Storage, not just its row',
  !stillThere.error && (stillThere.data ?? []).length === 0,
  JSON.stringify(stillThere.data ?? stillThere.error),
);

const { data: seats } = await admin.supabase.from('trip_seats').select('id');
check('no seat inventory is left', (seats ?? []).length === 0, String(seats?.length));

// ---------------------------------------------------------------------------
console.log('\nWhat it kept');
// ---------------------------------------------------------------------------

const adminAgain = await signIn('admin@palago.test');
check('the admin can still sign in', !adminAgain.error, adminAgain.error?.message);
check('and is the only account kept', after?.keep?.superAdmins === 1, JSON.stringify(after?.keep));

const turnaroundAfter = (await adminAgain.supabase.rpc('public_setting', { p_key: 'trip_turnaround_minutes' })).data;
check(
  'settings are kept',
  turnaroundAfter !== null && turnaroundAfter === turnaroundBefore,
  `${turnaroundBefore} -> ${turnaroundAfter}`,
);

// ---------------------------------------------------------------------------
console.log('\nThe empty platform is usable');
// ---------------------------------------------------------------------------

const a = adminAgain.supabase;
const stamp = Date.now().toString(36).slice(-4).toUpperCase();

const op = await a.rpc('create_operator', { p_name: 'First Real Operator', p_code: `REAL${stamp}` });
check('an admin can enter an operator into the empty platform', !op.error, op.error?.message);
const operatorId = op.data?.id;

const t1 = await a.rpc('create_terminal', {
  p_name: 'Origin Terminal', p_code: `O${stamp}`, p_city: 'Puerto Princesa', p_latitude: 9.74, p_longitude: 118.74,
});
const t2 = await a.rpc('create_terminal', {
  p_name: 'Destination Terminal', p_code: `D${stamp}`, p_city: 'El Nido', p_latitude: 11.2, p_longitude: 119.4,
});
check('and terminals', !t1.error && !t2.error, t1.error?.message ?? t2.error?.message);

const route = await a.rpc('create_route', {
  p_operator_id: operatorId, p_origin_terminal_id: t1.data?.id, p_destination_terminal_id: t2.data?.id, p_duration_minutes: 300,
});
check('and a route', !route.error, route.error?.message);

const bus = await a.rpc('create_bus', {
  p_operator_id: operatorId, p_plate_number: `PLT-${stamp}`, p_bus_number: `B-${stamp}`, p_capacity: 20,
});
check('and a coach', !bus.error, bus.error?.message);

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const trip = await a.rpc('create_trip', {
  p_route_id: route.data?.id,
  p_bus_id: bus.data?.id,
  p_trip_number: `FIRST-${stamp}`,
  p_departure_date: tomorrow,
  p_departure_time: '07:00',
  p_arrival_time: '12:00',
  p_fare: 60000,
  p_operator_id: operatorId,
});
check('and a trip', !trip.error, trip.error?.message);

// Reference numbers restarted: the first booking after a reset is 000001.
const booked = await a.rpc('create_booking', {
  p_trip_id: trip.data?.id,
  p_passengers: [{ name: 'First Passenger', type: 'ADULT' }],
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
check(
  'with what it deleted',
  log?.metadata?.deleted?.bookings === before.delete.bookings &&
    log?.metadata?.scope === 'EVERYTHING_EXCEPT_SUPER_ADMINS',
  JSON.stringify(log?.metadata),
);

console.log(`\n${passed} passed, ${failures.length} failed`);
console.log('\n  The local database is now empty of demo data. `pnpm db:reset` restores the seed.\n');
if (failures.length) {
  console.log('Failed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
