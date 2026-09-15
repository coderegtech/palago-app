/**
 * Row Level Security verification, run against the local stack.
 *
 *   pnpm db:verify
 *
 * Unit tests cannot cover RLS: the policies live in Postgres, and the only
 * honest way to know a passenger cannot read a driver's phone number is to sign
 * in as a passenger and try. This signs in as each seeded role through the
 * normal publishable key — exactly the access a real client has — and asserts
 * what each may and may not do.
 *
 * Run it after every migration that touches a policy.
 */

import { createClient } from '@supabase/supabase-js';
import { loadVerifyEnv } from './_verify-env.mjs';

const { url: URL, key: KEY } = loadVerifyEnv();
const PASSWORD = 'PalawanGo2026';

const client = () => createClient(URL, KEY, { auth: { persistSession: false } });

async function signIn(email) {
  const supabase = client();
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return supabase;
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

/** Rows the caller can see in a table. */
async function countable(supabase, table) {
  const { data, error } = await supabase.from(table).select('id');
  if (error) return { error: error.message, n: 0 };
  return { n: data.length };
}

const anon = client();
const passenger = await signIn('passenger@palago.test');
const cherry = await signIn('operator@palago.test');
const roro = await signIn('roro@palago.test');
const driver = await signIn('driver@palago.test');
const admin = await signIn('admin@palago.test');

console.log('\nAnonymous');
for (const table of ['profiles', 'operators', 'terminals', 'routes', 'trips', 'trip_seats', 'drivers']) {
  const { n, error } = await countable(anon, table);
  check(`anon cannot read ${table}`, n === 0, error ?? `saw ${n} rows`);
}

console.log('\nPassenger — reference data needed to book');
for (const table of ['operators', 'terminals', 'routes', 'buses', 'bus_seats', 'trips', 'trip_seats']) {
  const { n, error } = await countable(passenger, table);
  check(`passenger reads ${table}`, n > 0, error ?? 'saw 0 rows');
}

console.log('\nPassenger — must not see operator-internal records');
for (const table of ['drivers', 'assistants', 'trip_assignments']) {
  const { n } = await countable(passenger, table);
  check(`passenger cannot read ${table}`, n === 0, `saw ${n} rows`);
}

console.log('\nPassenger — must not write anything operational');
{
  const trip = (await passenger.from('trips').select('id, fare').limit(1)).data[0];

  const seat = (await passenger.from('trip_seats').select('id').eq('status', 'AVAILABLE').limit(1))
    .data[0];
  const held = await passenger
    .from('trip_seats')
    .update({ status: 'BOOKED' })
    .eq('id', seat.id)
    .select();
  check(
    'passenger cannot claim a seat directly (double-booking guard)',
    Boolean(held.error) || held.data?.length === 0,
    held.error ? '' : 'the update was applied',
  );

  const repriced = await passenger
    .from('trips')
    .update({ fare: 1 })
    .eq('id', trip.id)
    .select();
  check(
    'passenger cannot change a fare',
    Boolean(repriced.error) || repriced.data?.length === 0,
    repriced.error ? '' : 'the update was applied',
  );

  const invented = await passenger
    .from('terminals')
    .insert({ name: 'Fake', code: 'FAKE', latitude: 0, longitude: 0, city: 'X', province: 'Y' });
  check('passenger cannot create a terminal', Boolean(invented.error), 'insert succeeded');
}

console.log('\nOperator isolation — Cherry Bus vs RoRo Bus');
{
  const cherryDrivers = (await cherry.from('drivers').select('name, operator_id')).data ?? [];
  const roroDrivers = (await roro.from('drivers').select('name, operator_id')).data ?? [];

  // Asserted as "every row I can see is mine", not as a count. A count breaks
  // the next time the seed gains a driver, which says nothing about the policy.
  const cherryOperatorId = cherryDrivers[0]?.operator_id;
  const roroOperatorId = roroDrivers[0]?.operator_id;

  check(
    'Cherry sees only its own drivers',
    cherryDrivers.length > 0 && cherryDrivers.every((d) => d.operator_id === cherryOperatorId),
    `saw ${cherryDrivers.length}`,
  );
  check(
    'RoRo sees only its own drivers',
    roroDrivers.length > 0 && roroDrivers.every((d) => d.operator_id === roroOperatorId),
    `saw ${roroDrivers.length}`,
  );
  check(
    'the two operators see different drivers',
    cherryOperatorId !== roroOperatorId &&
      !cherryDrivers.some((d) => roroDrivers.some((r) => r.name === d.name)),
    'the two lists overlap',
  );

  // Reference data is readable by everyone signed in, so "the first bus RoRo
  // can see" is not necessarily RoRo's — both ids above are scoped explicitly,
  // or the test silently checks the wrong row.

  const roroBus = (
    await roro.from('buses').select('id, bus_number').eq('operator_id', roroOperatorId).limit(1)
  ).data[0];
  const hijack = await cherry
    .from('buses')
    .update({ name: 'Taken by Cherry' })
    .eq('id', roroBus.id)
    .select();
  check(
    "Cherry cannot edit RoRo's bus",
    Boolean(hijack.error) || hijack.data?.length === 0,
    'the update was applied',
  );

  const ownBus = (
    await cherry.from('buses').select('id').eq('operator_id', cherryOperatorId).limit(1)
  ).data[0];
  // Direct writes to reference data were withdrawn in
  // `20260915000032_bookable_trips.sql`: an edit that leaves no audit trail
  // cannot answer "who took that coach off the road".
  const directRename = await cherry
    .from('buses')
    .update({ name: 'Cherry Bus 001 (renamed)' })
    .eq('id', ownBus.id)
    .select();
  check(
    'nobody edits a bus by writing the table',
    directRename.error !== null || (directRename.data ?? []).length === 0,
    JSON.stringify(directRename.data),
  );

  const busRow = (
    await cherry.from('buses').select('bus_number, plate_number, name').eq('id', ownBus.id).single()
  ).data;
  const rename = await cherry.rpc('update_bus', {
    p_bus_id: ownBus.id,
    p_bus_number: busRow.bus_number,
    p_plate_number: busRow.plate_number,
    p_name: 'Cherry Bus 001 (renamed)',
  });
  const renamed = (await cherry.from('buses').select('name').eq('id', ownBus.id).single()).data;
  check(
    'Cherry can edit its own bus through update_bus',
    !rename.error && renamed.name === 'Cherry Bus 001 (renamed)',
    rename.error?.message ?? renamed.name,
  );
  await cherry.rpc('update_bus', {
    p_bus_id: ownBus.id,
    p_bus_number: busRow.bus_number,
    p_plate_number: busRow.plate_number,
    p_name: busRow.name,
  });

  const roroTrip = (
    await roro.from('trips').select('id').eq('operator_id', roroOperatorId).limit(1)
  ).data[0];
  const cancel = await cherry
    .from('trips')
    .update({ status: 'CANCELLED' })
    .eq('id', roroTrip.id)
    .select();
  check(
    "Cherry cannot cancel RoRo's trip",
    Boolean(cancel.error) || cancel.data?.length === 0,
    'the update was applied',
  );
}

console.log('\nOperator — must not write seat inventory either');
{
  const seat = (await cherry.from('trip_seats').select('id').eq('status', 'AVAILABLE').limit(1))
    .data[0];
  const taken = await cherry
    .from('trip_seats')
    .update({ status: 'BOOKED' })
    .eq('id', seat.id)
    .select();
  check(
    'operator cannot write trip_seats directly',
    Boolean(taken.error) || taken.data?.length === 0,
    'the update was applied',
  );
}

console.log('\nDriver');
{
  const assignments = (await driver.from('trip_assignments').select('id')).data ?? [];
  check('driver sees their own assignments', assignments.length > 0, `saw ${assignments.length}`);

  const own = (await driver.from('drivers').select('name, license_number')).data ?? [];
  check(
    'driver sees their own crew record',
    own.some((d) => d.license_number === 'DRV-001'),
    `saw ${own.map((d) => d.license_number).join(', ')}`,
  );
}

console.log('\nAdmin');
{
  // Asserted as "can see the other accounts", not a hardcoded count — adding a
  // seeded user should not break an unrelated policy test.
  const profiles = (await admin.from('profiles').select('id, email')).data ?? [];
  const seen = new Set(profiles.map((p) => p.email));
  const expected = [
    'passenger@palago.test',
    'passenger2@palago.test',
    'operator@palago.test',
    'roro@palago.test',
    'driver@palago.test',
    'assistant@palago.test',
    'admin@palago.test',
  ];
  const missing = expected.filter((email) => !seen.has(email));
  check('admin reads every seeded profile', missing.length === 0, `missing ${missing.join(', ')}`);

  // Named, not counted: a seed that gains a driver must not fail a policy test.
  const drivers = (await admin.from('drivers').select('license_number')).data ?? [];
  const licences = new Set(drivers.map((d) => d.license_number));
  check(
    'admin reads every driver, across operators',
    ['DRV-001', 'DRV-002', 'DRV-003'].every((l) => licences.has(l)),
    [...licences].join(', '),
  );
}

// ---------------------------------------------------------------------------
// Crew are staff, not managers
//
// Drivers and assistants carry their operator's id, and every write policy
// used to ask only "is this row your operator's?". Each check below re-reads
// the row as admin afterwards: an empty result without an error is exactly
// what a silently-applied-elsewhere write looks like, so the effect is what
// gets asserted.
// ---------------------------------------------------------------------------

console.log('\nCrew — must not manage the operator');
{
  const assistant = await signIn('assistant@palago.test');
  const cherryTrip = (
    await admin.from('trips').select('id, fare, status, operator_id')
      // Not by trip number: seeded numbers embed the date they were generated
      // for, so a hardcoded one is right for exactly one day.
      .eq('status', 'SCHEDULED')
      .order('departure_date')
      .order('departure_time')
      .limit(1)
      .single()
  ).data;
  const readTrip = async () =>
    (await admin.from('trips').select('fare, status').eq('id', cherryTrip.id).single()).data;

  const assignment = (
    await admin.from('trip_assignments').select('id, status')
      .eq('trip_id', cherryTrip.id).neq('status', 'CANCELLED').single()
  ).data;
  const readAssignment = async () =>
    (await admin.from('trip_assignments').select('status').eq('id', assignment.id).single()).data;

  // Each attempt that gets through is undone as admin before the next one, so a
  // regression reports every failing role instead of the first one poisoning
  // the rest.
  for (const [who, db] of [['driver', driver], ['assistant', assistant]]) {
    await db.from('trips').update({ fare: 1 }).eq('id', cherryTrip.id);
    const fare = (await readTrip()).fare;
    check(`${who} cannot change a fare`, fare === cherryTrip.fare, `fare is now ${fare}`);
    if (fare !== cherryTrip.fare) {
      await admin.from('trips').update({ fare: cherryTrip.fare }).eq('id', cherryTrip.id);
    }

    await db.from('trip_assignments').update({ status: 'CANCELLED' }).eq('id', assignment.id);
    const status = (await readAssignment()).status;
    check(`${who} cannot change a crew assignment`, status === assignment.status,
      `assignment is now ${status}`);
    if (status !== assignment.status) {
      await admin.from('trip_assignments').update({ status: assignment.status }).eq('id', assignment.id);
    }
  }

  const bus = (await admin.from('buses').select('id, name').eq('operator_id', cherryTrip.operator_id).limit(1).single()).data;
  await driver.from('buses').update({ name: 'Renamed by driver' }).eq('id', bus.id);
  check('driver cannot rename a bus',
    (await admin.from('buses').select('name').eq('id', bus.id).single()).data.name === bus.name);

  const op = (await admin.from('operators').select('id, name').eq('id', cherryTrip.operator_id).single()).data;
  await driver.from('operators').update({ name: 'Renamed by driver' }).eq('id', op.id);
  check('driver cannot edit the operator record',
    (await admin.from('operators').select('name').eq('id', op.id).single()).data.name === op.name);

  // Through the function crew creation actually moved into. A direct INSERT is
  // now refused for everybody, so testing that would prove nothing about the
  // driver specifically. (An earlier version of this check omitted
  // license_number and "passed" on a NOT NULL error — see AGENTS.md.)
  await driver.rpc('create_crew_member', {
    p_kind: 'DRIVER',
    p_name: 'Hired by driver',
    p_license_number: 'D00-00-000000',
    p_operator_id: cherryTrip.operator_id,
  });
  const hired = (await admin.from('drivers').select('id').eq('name', 'Hired by driver')).data ?? [];
  check('driver cannot add a driver', hired.length === 0, `${hired.length} row(s) created`);

  // Positive controls: an operator still manages its own fleet and crew —
  // through `update_trip` and `set_crew_availability`, since the direct writes
  // those replaced are gone.
  const tripRow = (
    await cherry
      .from('trips')
      .select('route_id, bus_id, trip_number, departure_date, departure_time, arrival_time, fare')
      .eq('id', cherryTrip.id)
      .single()
  ).data;

  const repriced = await cherry.rpc('update_trip', {
    p_trip_id: cherryTrip.id,
    p_route_id: tripRow.route_id,
    p_bus_id: tripRow.bus_id,
    p_trip_number: tripRow.trip_number,
    p_departure_date: tripRow.departure_date,
    p_departure_time: tripRow.departure_time,
    p_arrival_time: tripRow.arrival_time,
    p_fare: tripRow.fare + 100,
  });
  const afterFare = (await cherry.from('trips').select('fare').eq('id', cherryTrip.id).single()).data;
  check(
    'operator can still change its own fare',
    afterFare.fare === tripRow.fare + 100,
    repriced.error?.message ?? String(afterFare.fare),
  );
  await cherry.rpc('update_trip', {
    p_trip_id: cherryTrip.id,
    p_route_id: tripRow.route_id,
    p_bus_id: tripRow.bus_id,
    p_trip_number: tripRow.trip_number,
    p_departure_date: tripRow.departure_date,
    p_departure_time: tripRow.departure_time,
    p_arrival_time: tripRow.arrival_time,
    p_fare: tripRow.fare,
  });

  const crewDriver = (
    await admin
      .from('drivers')
      .select('id, availability_status')
      .eq('operator_id', cherryTrip.operator_id)
      .order('license_number')
      .limit(1)
      .single()
  ).data;
  const rested = await cherry.rpc('set_crew_availability', {
    p_kind: 'DRIVER',
    p_crew_id: crewDriver.id,
    p_status: 'UNAVAILABLE',
    p_reason: 'Rest day (verify-rls)',
  });
  const afterRest = (
    await admin.from('drivers').select('availability_status').eq('id', crewDriver.id).single()
  ).data;
  check(
    'operator can still set its own driver unavailable',
    afterRest.availability_status === 'UNAVAILABLE',
    rested.error?.message ?? afterRest.availability_status,
  );
  await cherry.rpc('set_crew_availability', {
    p_kind: 'DRIVER',
    p_crew_id: crewDriver.id,
    p_status: crewDriver.availability_status,
  });

  // Status moves only through set_trip_boarding / start_trip / end_trip.
  for (const [who, db] of [['operator', cherry], ['admin', admin]]) {
    await db.from('trips').update({ status: 'COMPLETED' }).eq('id', cherryTrip.id);
    check(`${who} cannot set a trip status directly`, (await readTrip()).status === cherryTrip.status,
      `status is now ${(await readTrip()).status}`);
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
