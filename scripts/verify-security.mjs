/**
 * Phase 13 — what the database refuses to a signed-in client.
 *
 *   pnpm db:verify:security
 *
 * The other fourteen suites prove that each feature works and that the obvious
 * attacks on it fail. This one asks a narrower question: for every table the
 * schema has deliberately taken away from clients, is the *grant* actually
 * gone — or only the button?
 *
 * That distinction is not theoretical. Three of the checks below were written
 * against the pre-migration schema and passed nothing: an operator really could
 * hard-delete a trip, really could put a rival operator's driver on their own
 * trip by writing `trip_assignments` directly, and really could bypass every
 * validation in `assign_trip_crew` by not calling it. The policies said
 * FOR ALL; only `insert, update` had been revoked. See
 * 20260916000033_write_scope_hardening.sql.
 *
 * So the rule this suite encodes is: a privileged operation is only as narrow
 * as its narrowest path. If a SECURITY DEFINER function validates five things
 * and the table underneath it still accepts a direct write, the function is
 * documentation, not enforcement.
 *
 * Read-only. It creates nothing and leaves nothing behind — every check here is
 * an attempt that should fail, and the few that should succeed are reads.
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

/**
 * A write that must not happen.
 *
 * Asserts the *effect* — the row count the server admits to changing — rather
 * than the error text, because the two failure modes look different and only
 * one of them is safe. A revoked grant answers 42501; RLS with no matching
 * policy answers no error at all and silently changes nothing. Both are a pass.
 * What must never happen is rows actually moving.
 */
async function refused(name, run) {
  const { error, count } = await run();
  const changed = count ?? 0;
  check(name, Boolean(error) || changed === 0, error ? '' : `${changed} row(s) changed`);
  return { error, changed };
}

const admin = await signIn('admin@palago.test');
const cherry = await signIn('operator@palago.test');
const roro = await signIn('roro@palago.test');
const driver = await signIn('driver@palago.test');
const passenger = await signIn('passenger@palago.test');
const anon = client();

// ---------------------------------------------------------------------------
console.log('\nThe schedule tables belong to their functions');
// ---------------------------------------------------------------------------

const { data: cherryTrips } = await cherry.supabase
  .from('operator_trip_overview')
  .select('id, trip_number')
  .limit(1);
const cherryTrip = cherryTrips?.[0];
check('a Cherry trip is readable to plan against', Boolean(cherryTrip), 'no trip found');

// `bookings.trip_id` is ON DELETE RESTRICT, so a *sold* trip is held by its
// foreign key whatever the grants say. Pick one with no booking, or the check
// passes for the wrong reason — the FK, not the policy.
const { data: soldTripIds } = await admin.supabase.from('bookings').select('trip_id');
const sold = new Set((soldTripIds ?? []).map((b) => b.trip_id));
const { data: allCherry } = await cherry.supabase
  .from('operator_trip_overview')
  .select('id, trip_number');
const unsold = (allCherry ?? []).find((t) => !sold.has(t.id));
check('an unsold Cherry trip exists to try deleting', Boolean(unsold), 'every trip has a booking');

if (unsold) {
  await refused('an operator cannot hard-delete their own trip', () =>
    cherry.supabase.from('trips').delete({ count: 'exact' }).eq('id', unsold.id),
  );
  const { data: stillThere } = await admin.supabase
    .from('trips')
    .select('id')
    .eq('id', unsold.id)
    .maybeSingle();
  check('and the trip is still on the record', Boolean(stillThere), 'the row is gone');
}

await refused('an admin cannot hard-delete a trip either', () =>
  admin.supabase.from('trips').delete({ count: 'exact' }).eq('id', unsold?.id ?? cherryTrip?.id),
);

// ---------------------------------------------------------------------------
console.log('\nCrew assignment has exactly one door');
// ---------------------------------------------------------------------------

const { data: roroCrew } = await roro.supabase
  .from('operator_crew')
  .select('id, name, operator_id')
  .eq('crew_kind', 'DRIVER')
  .limit(1);
const rivalDriver = roroCrew?.[0];
check("RoRo's own crew is readable to RoRo", Boolean(rivalDriver), 'no RoRo driver found');

if (cherryTrip && rivalDriver) {
  // The hole this suite was written for. The policy on trip_assignments asked
  // whether the caller manages the *trip's* operator and never looked at the
  // driver, so this insert succeeded and put a RoRo driver on a Cherry trip.
  const planted = await refused(
    "an operator cannot plant a rival's driver by writing trip_assignments",
    async () => {
      const { data, error } = await cherry.supabase
        .from('trip_assignments')
        .insert({ trip_id: cherryTrip.id, driver_id: rivalDriver.id, status: 'ASSIGNED' })
        .select('id');
      // Undo immediately if the schema let it through, so a failing run does
      // not leave a rival's driver rostered on somebody else's bus.
      if (data?.[0]?.id) await cherry.supabase.from('trip_assignments').delete().eq('id', data[0].id);
      return { error, count: data?.length ?? 0 };
    },
  );
  if (!planted.error) {
    console.log('        (the planted row was removed again)');
  }

  // The same refusal through the front door, where it was always enforced.
  const { error: rpcError } = await cherry.supabase.rpc('assign_trip_crew', {
    p_trip_id: cherryTrip.id,
    p_driver_id: rivalDriver.id,
    p_assistant_id: null,
  });
  check(
    "and assign_trip_crew refuses a rival's driver too",
    Boolean(rpcError),
    'the RPC accepted it',
  );
}

// Stand a driver down for the duration rather than hunting for one that is
// already UNAVAILABLE. A clean seed has none, so the first cut of this check
// silently skipped itself and reported twenty-one passes where there were
// twenty-two — which reads exactly like coverage and is not.
const { data: benchable } = await cherry.supabase
  .from('operator_crew')
  .select('id, name, availability_status')
  .eq('crew_kind', 'DRIVER')
  .eq('availability_status', 'AVAILABLE')
  .limit(1);
const bench = benchable?.[0];
check('a Cherry driver is available to stand down', Boolean(bench), 'no AVAILABLE driver found');

if (cherryTrip && bench) {
  const { error: benchError } = await cherry.supabase.rpc('set_crew_availability', {
    p_kind: 'DRIVER',
    p_crew_id: bench.id,
    p_status: 'UNAVAILABLE',
    p_reason: 'verify-security: rest day',
  });
  check('an operator can stand their own driver down', !benchError, benchError?.message);

  await refused(
    'an operator cannot roster an UNAVAILABLE driver by writing the table',
    async () => {
      const { data, error } = await cherry.supabase
        .from('trip_assignments')
        .insert({ trip_id: cherryTrip.id, driver_id: bench.id, status: 'ASSIGNED' })
        .select('id');
      if (data?.[0]?.id) await cherry.supabase.from('trip_assignments').delete().eq('id', data[0].id);
      return { error, count: data?.length ?? 0 };
    },
  );

  // And the front door refuses it as well, which is the check that would still
  // pass if somebody restored the grant.
  const { error: rpcBenched } = await cherry.supabase.rpc('assign_trip_crew', {
    p_trip_id: cherryTrip.id,
    p_driver_id: bench.id,
    p_assistant_id: null,
  });
  check('and assign_trip_crew refuses them too', Boolean(rpcBenched), 'the RPC rostered them');

  // Put them back on the roster — this suite leaves nothing behind.
  const { error: restored } = await cherry.supabase.rpc('set_crew_availability', {
    p_kind: 'DRIVER',
    p_crew_id: bench.id,
    p_status: 'AVAILABLE',
    p_reason: null,
  });
  check('the driver is made available again', !restored, restored?.message);
}

// Crew are not managers — the lesson from 20260911000024_staff_write_scope.sql,
// re-asked against the new table.
if (cherryTrip) {
  await refused('a driver cannot roster anybody, including themselves', async () => {
    const { data, error } = await driver.supabase
      .from('trip_assignments')
      .insert({ trip_id: cherryTrip.id, driver_id: bench?.id ?? null, status: 'ASSIGNED' })
      .select('id');
    if (data?.[0]?.id) await admin.supabase.from('trip_assignments').delete().eq('id', data[0].id);
    return { error, count: data?.length ?? 0 };
  });

  await refused('a passenger cannot cancel a crew assignment', () =>
    passenger.supabase
      .from('trip_assignments')
      .update({ status: 'CANCELLED' }, { count: 'exact' })
      .eq('trip_id', cherryTrip.id),
  );
}

// ---------------------------------------------------------------------------
console.log('\nA coach and its seats');
// ---------------------------------------------------------------------------

const { data: ownSeat } = await cherry.supabase.from('bus_seats').select('id, bus_id').limit(1);

if (ownSeat?.[0]) {
  await refused('an operator cannot edit a seat layout directly', () =>
    cherry.supabase
      .from('bus_seats')
      .update({ seat_number: 'HACK' }, { count: 'exact' })
      .eq('id', ownSeat[0].id),
  );
  await refused('an operator cannot delete a seat', () =>
    cherry.supabase.from('bus_seats').delete({ count: 'exact' }).eq('id', ownSeat[0].id),
  );
}

// `operator_fleet` is the one auto-updatable view in the schema. It carries
// security_invoker=true, so a write through it is checked against the caller's
// own grants on `buses` — which were withdrawn. Worth holding in place: drop
// security_invoker and this becomes a way to edit any operator's coaches.
const { data: fleetRow } = await cherry.supabase.from('operator_fleet').select('id').limit(1);
if (fleetRow?.[0]) {
  await refused('a write through the operator_fleet view does not reach buses', () =>
    cherry.supabase
      .from('operator_fleet')
      .update({ plate_number: 'HACK-000' }, { count: 'exact' })
      .eq('id', fleetRow[0].id),
  );
}

// ---------------------------------------------------------------------------
console.log('\nOne operator cannot see another');
// ---------------------------------------------------------------------------

// operator_crew is the schema's only remaining owner-rights view: it reads past
// RLS on drivers, assistants and profiles, and its WHERE clause is the entire
// boundary. That is the shape of the bug that once showed RoRo's coaches on the
// Cherry fleet screen, so it is asked directly rather than assumed.
const { data: cherrySees } = await cherry.supabase.from('operator_crew').select('id, operator_id');
const { data: operators } = await admin.supabase.from('operators').select('id, code');
const roroId = operators?.find((o) => o.code === 'RORO')?.id;

check(
  'an operator sees crew through operator_crew',
  (cherrySees ?? []).length > 0,
  'the view returned nothing',
);
check(
  "and none of them belong to a rival operator",
  (cherrySees ?? []).every((row) => row.operator_id !== roroId),
  `${(cherrySees ?? []).filter((r) => r.operator_id === roroId).length} RoRo row(s) leaked`,
);

const { data: passengerSees } = await passenger.supabase.from('operator_crew').select('id');
check(
  'a passenger sees no crew at all',
  (passengerSees ?? []).length === 0,
  `${passengerSees?.length} row(s)`,
);

// ---------------------------------------------------------------------------
console.log('\nThe trip lifecycle needs a session');
// ---------------------------------------------------------------------------

for (const fn of ['start_trip', 'set_trip_boarding']) {
  const { error } = await anon.rpc(fn, { p_trip_id: cherryTrip?.id });
  check(`${fn} is not callable without signing in`, Boolean(error), 'an anonymous caller got through');
}

// A signed-in passenger is authenticated but not crew. This one is about the
// function's own guard rather than the grant.
for (const fn of ['start_trip', 'set_trip_boarding']) {
  const { error } = await passenger.supabase.rpc(fn, { p_trip_id: cherryTrip?.id });
  check(`${fn} refuses a passenger`, Boolean(error), 'a passenger moved a trip');
}

// ---------------------------------------------------------------------------
console.log('\nNothing was left behind');
// ---------------------------------------------------------------------------

const { data: crossOperator } = await admin.supabase
  .from('trip_assignments')
  .select('id, trip_id, driver_id')
  .not('driver_id', 'is', null);

const { data: driversAll } = await admin.supabase.from('drivers').select('id, operator_id');
const { data: tripsAll } = await admin.supabase.from('trips').select('id, operator_id');
const driverOp = new Map((driversAll ?? []).map((d) => [d.id, d.operator_id]));
const tripOp = new Map((tripsAll ?? []).map((t) => [t.id, t.operator_id]));
const mismatched = (crossOperator ?? []).filter(
  (a) => driverOp.get(a.driver_id) && tripOp.get(a.trip_id) &&
    driverOp.get(a.driver_id) !== tripOp.get(a.trip_id),
);

check(
  'no driver is rostered on another operator\'s trip',
  mismatched.length === 0,
  `${mismatched.length} cross-operator assignment(s)`,
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
