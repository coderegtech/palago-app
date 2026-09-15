/**
 * Admin console — verified against the local stack with real signed-in roles,
 * through the ordinary publishable key. No service-role key: the point is to
 * prove what an actual signed-in admin can do that nobody else can.
 *
 *   pnpm db:verify:admin
 *
 * What this exists to prove, none of which a unit test can show:
 *
 *   - `admin_dashboard` answers for an admin and raises FORBIDDEN for a
 *     passenger, an operator and a driver — platform-wide figures are not a
 *     thing an operator may read about its rivals
 *   - its per-operator revenue equals what that operator sees on its own
 *     dashboard, so the two consoles cannot disagree about money
 *   - an admin can create operators, terminals, routes and buses
 *   - a passenger can create NONE of them, and an operator cannot create an
 *     operator or a terminal
 *   - an operator cannot add a bus or a route to a RIVAL's fleet
 *   - `create_bus` generates exactly `capacity` seats in the same transaction,
 *     so a bus can never exist with a seat map that disagrees with its capacity
 *   - a duplicate plate number and an absurd capacity are both refused
 *
 * Cleans up everything it creates, so it is re-runnable.
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
  return { supabase, email, userId: data.user.id };
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
const cherry = await signIn('operator@palago.test');
const roro = await signIn('roro@palago.test');
const passenger = await signIn('passenger@palago.test');
const driver = await signIn('driver@palago.test');
const anon = client();

// Distinctive codes so a leftover row from a failed run is obvious and cannot
// collide with the seed's own data.
// Stamped with the run. Reference data has no hard-delete path any more —
// operators, terminals, routes and buses are referenced by trips, bookings and
// tickets, so they are deactivated, never removed — which means a second run
// cannot reuse the same codes.
const TAG = `ZZ${Date.now().toString(36).slice(-5).toUpperCase()}`;

/** Delete in FK order: routes reference terminals with ON DELETE RESTRICT. */
/**
 * Stand everything this run made down again.
 *
 * Deactivation, not deletion. `20260915000032_bookable_trips.sql` withdrew
 * every client DELETE on reference data, because an operator, a coach or a
 * terminal is referenced by trips, bookings, payments and tickets, and removing
 * one would take the history of a journey with it. So the honest "clean up" is
 * the same thing the console's Delete button does: mark it inactive, where it
 * can no longer be used for anything new.
 */
async function standDown() {
  const { data: operators } = await admin.supabase
    .from('operators')
    .select('id')
    .like('code', `${TAG}%`);

  for (const row of operators ?? []) {
    const { data: buses } = await admin.supabase
      .from('buses')
      .select('id')
      .eq('operator_id', row.id);
    for (const bus of buses ?? []) {
      await admin.supabase.rpc('set_bus_status', { p_bus_id: bus.id, p_status: 'INACTIVE' });
    }

    const { data: routes } = await admin.supabase
      .from('routes')
      .select('id')
      .eq('operator_id', row.id);
    for (const route of routes ?? []) {
      await admin.supabase.rpc('set_route_status', { p_route_id: route.id, p_status: 'INACTIVE' });
    }

    await admin.supabase.rpc('set_operator_status', {
      p_operator_id: row.id,
      p_status: 'INACTIVE',
      p_reason: 'verify-admin cleanup',
    });
  }

  const { data: terminals } = await admin.supabase
    .from('terminals')
    .select('id')
    .like('code', `${TAG}%`);
  for (const terminal of terminals ?? []) {
    await admin.supabase.rpc('set_terminal_status', {
      p_terminal_id: terminal.id,
      p_status: 'INACTIVE',
    });
  }
}

// ---------------------------------------------------------------------------
console.log('\nWho may read platform analytics');
// ---------------------------------------------------------------------------

const adminView = await admin.supabase.rpc('admin_dashboard', {});
check('an admin can read the platform dashboard', !adminView.error, adminView.error?.message);
check(
  'it carries platform counts',
  typeof adminView.data?.platform?.operators === 'number',
  JSON.stringify(adminView.data?.platform),
);
check(
  'and a per-operator breakdown',
  Array.isArray(adminView.data?.operators) && adminView.data.operators.length >= 2,
  String(adminView.data?.operators?.length),
);

for (const [label, who] of [
  ['a passenger', passenger],
  ['an operator', cherry],
  ['a driver', driver],
]) {
  const denied = await who.supabase.rpc('admin_dashboard', {});
  check(
    `${label} cannot read it`,
    denied.error?.message === 'FORBIDDEN',
    denied.error?.message,
  );
}

const anonView = await anon.rpc('admin_dashboard', {});
check('an anonymous caller cannot read it', Boolean(anonView.error), anonView.error?.message);

// The two consoles must agree about money.
const today = new Date().toISOString().slice(0, 10);
const adminToday = await admin.supabase.rpc('admin_dashboard', { p_date: today });
const cherryToday = await cherry.supabase.rpc('operator_dashboard', { p_date: today });
const cherryInAdmin = (adminToday.data?.operators ?? []).find((o) => o.code === 'CHERRY');
check(
  "the admin's figure for an operator equals that operator's own",
  cherryInAdmin?.revenue === cherryToday.data?.today?.revenue,
  `${cherryInAdmin?.revenue} vs ${cherryToday.data?.today?.revenue}`,
);

// ---------------------------------------------------------------------------
console.log('\nCreating reference data');
// ---------------------------------------------------------------------------

// Through the functions reference data moved into, not straight at the tables:
// an edit or a deactivation that leaves no audit trail cannot answer "who took
// that coach off the road, and when".
const directOperator = await admin.supabase
  .from('operators')
  .insert({ name: 'Written Straight To The Table', code: `${TAG}RAW` });
check('nobody creates an operator by writing the table', Boolean(directOperator.error));

const newOperator = await admin.supabase.rpc('create_operator', {
  p_name: 'Test Lines',
  p_code: `${TAG}OP`,
  p_contact_email: 'ops@test.invalid',
});
check('an admin can create an operator', !newOperator.error, newOperator.error?.message);
const operatorId = newOperator.data?.id;

const operatorByOperator = await cherry.supabase.rpc('create_operator', {
  p_name: 'Self Promotion',
  p_code: `${TAG}SP`,
});
check(
  'an operator cannot create another operator',
  operatorByOperator.error?.message === 'FORBIDDEN',
  operatorByOperator.error?.message ?? 'it succeeded',
);

const terminalA = await admin.supabase.rpc('create_terminal', {
  p_name: 'Test North',
  p_code: `${TAG}A`,
  p_city: 'Taytay',
  p_latitude: 10.8,
  p_longitude: 119.5,
});
const terminalB = await admin.supabase.rpc('create_terminal', {
  p_name: 'Test South',
  p_code: `${TAG}B`,
  p_city: 'Narra',
  p_latitude: 9.27,
  p_longitude: 118.4,
});
check('an admin can create terminals', !terminalA.error && !terminalB.error, terminalA.error?.message);

const badTerminal = await admin.supabase.rpc('create_terminal', {
  p_name: 'Off world',
  p_code: `${TAG}X`,
  p_city: 'Nowhere',
  p_latitude: 200,
  p_longitude: 0,
});
check(
  'an impossible latitude is refused by the schema',
  badTerminal.error?.message === 'VALIDATION_ERROR',
  badTerminal.error?.message ?? 'it succeeded',
);

const newRoute = await admin.supabase.rpc('create_route', {
  p_operator_id: operatorId,
  p_origin_terminal_id: terminalA.data?.id,
  p_destination_terminal_id: terminalB.data?.id,
  p_duration_minutes: 240,
});
check('an admin can create a route', !newRoute.error, newRoute.error?.message);

const sameTerminal = await admin.supabase.rpc('create_route', {
  p_operator_id: operatorId,
  p_origin_terminal_id: terminalA.data?.id,
  p_destination_terminal_id: terminalA.data?.id,
  p_duration_minutes: 60,
});
check(
  'a route that starts and ends in the same place is refused',
  sameTerminal.error?.message === 'VALIDATION_ERROR',
  sameTerminal.error?.message ?? 'it succeeded',
);

// ---------------------------------------------------------------------------
console.log('\nAdding a bus builds its seat map');
// ---------------------------------------------------------------------------

const bus = await admin.supabase.rpc('create_bus', {
  p_operator_id: operatorId,
  p_plate_number: `${TAG} 0001`,
  p_bus_number: `${TAG}-01`,
  p_capacity: 30,
  p_bus_type: 'BUS',
  p_name: 'Test Coach',
});
check('an admin can create a bus', !bus.error, bus.error?.message);
check('the reported seat count equals the capacity', bus.data?.seats === 30, JSON.stringify(bus.data));

const { data: seatRows } = await admin.supabase
  .from('bus_seats')
  .select('seat_number')
  .eq('bus_id', bus.data?.id);
check(
  'and the seats really exist, exactly capacity many',
  seatRows?.length === 30,
  String(seatRows?.length),
);
check(
  'the layout is 2+2 — four seats per row',
  new Set((seatRows ?? []).map((s) => s.seat_number.slice(-1))).size === 4,
);

const dupe = await admin.supabase.rpc('create_bus', {
  p_operator_id: operatorId,
  p_plate_number: `${TAG} 0001`,
  p_bus_number: `${TAG}-02`,
  p_capacity: 30,
});
check(
  'a duplicate plate number is refused',
  dupe.error?.message === 'VALIDATION_ERROR',
  dupe.error?.message,
);

const absurd = await admin.supabase.rpc('create_bus', {
  p_operator_id: operatorId,
  p_plate_number: `${TAG} 0002`,
  p_bus_number: `${TAG}-03`,
  p_capacity: 5000,
});
check(
  'an absurd capacity is refused',
  absurd.error?.message === 'VALIDATION_ERROR',
  absurd.error?.message,
);

const noSuchOperator = await admin.supabase.rpc('create_bus', {
  p_operator_id: '00000000-0000-0000-0000-000000000000',
  p_plate_number: `${TAG} 0003`,
  p_bus_number: `${TAG}-04`,
  p_capacity: 20,
});
check(
  'a bus for an operator that does not exist is refused',
  noSuchOperator.error?.message === 'NOT_FOUND',
  noSuchOperator.error?.message,
);

// ---------------------------------------------------------------------------
console.log('\nWho may write reference data');
// ---------------------------------------------------------------------------

const passengerOperator = await passenger.supabase
  .from('operators')
  .insert({ name: 'Rogue Lines', code: `${TAG}ROGUE` });
check('a passenger cannot create an operator', Boolean(passengerOperator.error));

const passengerTerminal = await passenger.supabase
  .from('terminals')
  .insert({ name: 'Rogue', code: `${TAG}R`, city: 'X', latitude: 10, longitude: 119 });
check('a passenger cannot create a terminal', Boolean(passengerTerminal.error));

const passengerBus = await passenger.supabase.rpc('create_bus', {
  p_operator_id: operatorId,
  p_plate_number: `${TAG} 9998`,
  p_bus_number: `${TAG}-98`,
  p_capacity: 20,
});
check(
  'a passenger cannot create a bus',
  passengerBus.error?.message === 'FORBIDDEN',
  passengerBus.error?.message,
);

// Asserted separately from the error above, and deliberately so. The first
// version of `create_bus` returned no error AND created the bus, because
// `p_operator_id = current_operator_id()` is NULL rather than false for a
// caller with no operator. Checking only the message would have passed a
// function that quietly let passengers into every operator's fleet.
const { data: ghostBus } = await admin.supabase
  .from('buses')
  .select('id')
  .eq('plate_number', `${TAG} 9998`);
check(
  'and no bus was created behind the refusal',
  (ghostBus?.length ?? 0) === 0,
  String(ghostBus?.length),
);

const operatorMakesOperator = await cherry.supabase
  .from('operators')
  .insert({ name: 'Cherry Holdings', code: `${TAG}CH` });
check('an operator cannot create another operator', Boolean(operatorMakesOperator.error));

const operatorMakesTerminal = await cherry.supabase
  .from('terminals')
  .insert({ name: 'Cherry Depot', code: `${TAG}CD`, city: 'X', latitude: 10, longitude: 119 });
check('an operator cannot create a terminal', Boolean(operatorMakesTerminal.error));

const rivalBus = await roro.supabase.rpc('create_bus', {
  p_operator_id: operatorId,
  p_plate_number: `${TAG} 9999`,
  p_bus_number: `${TAG}-99`,
  p_capacity: 20,
});
check(
  "an operator cannot add a bus to another operator's fleet",
  rivalBus.error?.message === 'FORBIDDEN',
  rivalBus.error?.message,
);

const rivalRoute = await roro.supabase.rpc('create_route', {
  p_operator_id: operatorId,
  p_origin_terminal_id: terminalA.data?.id,
  p_destination_terminal_id: terminalB.data?.id,
  p_duration_minutes: 120,
});
check(
  "an operator cannot add a route to another operator's network",
  rivalRoute.error?.message === 'FORBIDDEN',
  rivalRoute.error?.message ?? 'it succeeded',
);

// An operator adding to its OWN fleet is allowed — the same RPC, different owner.
const { data: cherryRow } = await cherry.supabase
  .from('operators')
  .select('id')
  .eq('code', 'CHERRY')
  .single();
const ownBus = await cherry.supabase.rpc('create_bus', {
  p_operator_id: cherryRow?.id,
  p_plate_number: `${TAG} 0100`,
  p_bus_number: `${TAG}-100`,
  p_capacity: 12,
});
check('but an operator CAN add to its own fleet', !ownBus.error, ownBus.error?.message);

const directBusDelete = await admin.supabase.from('buses').delete().eq('id', ownBus.data?.id).select();
check(
  'and no client can delete a coach, not even an admin',
  directBusDelete.error !== null || (directBusDelete.data ?? []).length === 0,
  JSON.stringify(directBusDelete.data),
);
if (ownBus.data?.id) {
  await cherry.supabase.rpc('set_bus_status', { p_bus_id: ownBus.data.id, p_status: 'INACTIVE' });
}

// ---------------------------------------------------------------------------
console.log('\nThe trail it leaves');
// ---------------------------------------------------------------------------

const { data: audit } = await admin.supabase
  .from('audit_logs')
  .select('action')
  .eq('entity_id', bus.data?.id);
check(
  'creating a bus is audited',
  (audit ?? []).some((row) => row.action === 'BUS_CREATED'),
  JSON.stringify(audit),
);

await standDown();

const { data: leftover } = await admin.supabase
  .from('operators')
  .select('code, status')
  .like('code', `${TAG}%`);
check(
  'everything the suite created is stood down, and still on the record',
  (leftover?.length ?? 0) > 0 && (leftover ?? []).every((o) => o.status === 'INACTIVE'),
  JSON.stringify(leftover),
);

const { data: leftBuses } = await admin.supabase
  .from('buses')
  .select('status')
  .like('bus_number', `${TAG}%`);
check(
  'including its coaches',
  (leftBuses ?? []).every((b) => b.status === 'INACTIVE'),
  JSON.stringify(leftBuses),
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
