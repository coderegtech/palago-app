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

const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
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
  check('Cherry sees only its own drivers', cherryDrivers.length === 1, `saw ${cherryDrivers.length}`);
  check('RoRo sees only its own drivers', roroDrivers.length === 1, `saw ${roroDrivers.length}`);
  check(
    'the two operators see different drivers',
    cherryDrivers[0]?.name !== roroDrivers[0]?.name,
    'both saw the same row',
  );

  // Reference data is readable by everyone signed in, so "the first bus RoRo
  // can see" is not necessarily RoRo's. Scope by operator explicitly, or the
  // test silently checks the wrong row.
  const cherryOperatorId = cherryDrivers[0].operator_id;
  const roroOperatorId = roroDrivers[0].operator_id;

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
  const rename = await cherry
    .from('buses')
    .update({ name: 'Cherry Bus 001 (renamed)' })
    .eq('id', ownBus.id)
    .select();
  check('Cherry can edit its own bus', !rename.error && rename.data.length === 1, rename.error?.message);
  await cherry.from('buses').update({ name: 'Cherry Bus 001' }).eq('id', ownBus.id);

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

  const own = (await driver.from('drivers').select('name')).data ?? [];
  check('driver sees their own crew record', own.length === 1, `saw ${own.length}`);
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

  const drivers = (await admin.from('drivers').select('id')).data ?? [];
  check('admin reads every driver', drivers.length === 2, `saw ${drivers.length}`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
