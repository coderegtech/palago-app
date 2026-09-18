/**
 * Fill the database with realistic mock data, through the app's own front doors.
 *
 *   pnpm db:mock                                  # local stack, default volume
 *   pnpm db:mock -- --operators 3 --days 10 --passengers 20 --seed 7
 *   pnpm db:mock -- --target cloud --yes          # hosted project (see below)
 *
 * It does not INSERT into tables. Every row is made by the same RPC or Edge
 * Function the app calls, signed in as the person who would make it:
 *
 *   admin           → operators, terminals, routes, coaches, schedules,
 *                     operator-admin accounts (manage-staff)
 *   operator admin  → its drivers and crew (manage-staff), crew rosters,
 *                     walk-in counter sales paid in CASH
 *   passengers      → sign up, top up wallets, book, pay by the mock provider
 *                     or by wallet, cancel
 *
 * So the data obeys every rule the real data will — fares are priced by
 * `create_booking`, seat numbers are assigned by the payment functions, no bus
 * or driver is double-booked (the exclusion constraints would refuse it), and
 * each payment has its receipt. A rule the generator breaks is a failure it
 * reports, not a row it sneaks in. That is also why it needs
 * `pnpm functions:serve` running locally.
 *
 * It works on an empty platform — straight after the admin data reset, when
 * only the admins are left — and alongside the seed. Operator codes and e-mail
 * addresses carry a per-run tag, so running it twice adds a second batch rather
 * than colliding with the first. Terminals are shared: an existing terminal
 * with the same code is reused.
 *
 * Not generated: rewards (the catalogue has no client write path at all — it
 * is SQL-only) and completed-trip history (a trip cannot be scheduled in the
 * past, and departing one needs a driver on the day). Loyalty points therefore
 * start at zero; they arrive when a driver ends a trip.
 *
 * Target. Local by default, found the way the verify suites find it. `--target
 * cloud` uses EXPO_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY from `.env` and needs
 * `--yes` and an admin login in MOCK_ADMIN_EMAIL / MOCK_ADMIN_PASSWORD — the
 * seeded admin does not exist there. Every account it creates shares one
 * password (MOCK_PASSWORD, default PalawanGo2026) and a @mock.palago.test
 * address, so on a hosted project remove them afterwards with the data reset.
 *
 * Auth rate limit: signing up and signing in is limited per IP (30 per five
 * minutes on the local stack). The default volume stays under it; a larger one
 * waits out the window and says so rather than failing.
 */

import { createClient } from '@supabase/supabase-js';

import { loadVerifyEnv } from './_verify-env.mjs';
import { makeInvoke } from './_verify-invoke.mjs';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { target: 'local', operators: 2, busesPerOperator: 3, days: 7, passengers: 10, seed: null, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--') continue;
    else if (arg === '--yes') out.yes = true;
    else if (arg === '--target') out.target = next();
    else if (arg === '--operators') out.operators = Number(next());
    else if (arg === '--buses') out.busesPerOperator = Number(next());
    else if (arg === '--days') out.days = Number(next());
    else if (arg === '--passengers') out.passengers = Number(next());
    else if (arg === '--seed') out.seed = Number(next());
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown option ${arg}. Try --help.`);
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help) {
  console.log(`
  pnpm db:mock [-- options]

    --operators N    operators to create            (default 2, max 6)
    --buses N        coaches per operator           (default 3, max 8)
    --days N         days of schedules from tomorrow (default 7, max 30)
    --passengers N   passenger accounts             (default 10)
    --seed N         repeatable randomness          (default: random)
    --target local|cloud                            (default local)
    --yes            required with --target cloud
`);
  process.exit(0);
}

for (const [name, value, max] of [
  ['--operators', opts.operators, 6],
  ['--buses', opts.busesPerOperator, 8],
  ['--days', opts.days, 30],
  ['--passengers', opts.passengers, 200],
]) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be a whole number from 1 to ${max}.`);
  }
}

function readDotEnv() {
  const file = path.resolve(import.meta.dirname, '..', '.env');
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }),
  );
}

let URL_;
let KEY;
let adminEmail = process.env.MOCK_ADMIN_EMAIL ?? 'admin@palago.test';
let adminPassword = process.env.MOCK_ADMIN_PASSWORD ?? 'PalawanGo2026';

if (opts.target === 'local') {
  ({ url: URL_, key: KEY } = loadVerifyEnv());
} else if (opts.target === 'cloud') {
  const env = { ...readDotEnv(), ...process.env };
  URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
  KEY = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!URL_ || !KEY) throw new Error('--target cloud needs EXPO_PUBLIC_SUPABASE_URL and _PUBLISHABLE_KEY in .env.');
  if (!process.env.MOCK_ADMIN_EMAIL || !process.env.MOCK_ADMIN_PASSWORD) {
    throw new Error('--target cloud needs MOCK_ADMIN_EMAIL and MOCK_ADMIN_PASSWORD (a SUPER_ADMIN on that project).');
  }
  if (!opts.yes) {
    throw new Error(
      `This writes mock accounts, schedules, bookings and payments into ${new URL(URL_).host}.\n` +
        '  Add --yes to confirm. Remove them afterwards with the admin data reset.',
    );
  }
} else {
  throw new Error('--target must be local or cloud.');
}

const PASSWORD = process.env.MOCK_PASSWORD ?? 'PalawanGo2026';
const invoke = makeInvoke(URL_, KEY);

// ---------------------------------------------------------------------------
// Repeatable randomness (mulberry32)
// ---------------------------------------------------------------------------

const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
let state = seed >>> 0;
function rand() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const shuffle = (list) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// Per-run tag: keeps codes and e-mails unique across runs. Not from the seed,
// so the same --seed twice still makes two distinct batches.
const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const tag = TAG.toLowerCase();

// ---------------------------------------------------------------------------
// Reference material
// ---------------------------------------------------------------------------

const TERMINALS = [
  { code: 'PPS', name: 'San Jose Terminal', city: 'Puerto Princesa', lat: 9.7778, lng: 118.7424 },
  { code: 'ELN', name: 'El Nido Terminal', city: 'El Nido', lat: 11.1784, lng: 119.393 },
  { code: 'TAY', name: 'Taytay Terminal', city: 'Taytay', lat: 10.8262, lng: 119.5125 },
  { code: 'RXS', name: 'Roxas Terminal', city: 'Roxas', lat: 10.3194, lng: 119.346 },
  { code: 'SVC', name: 'San Vicente Terminal', city: 'San Vicente', lat: 10.527, lng: 119.2555 },
  { code: 'NAR', name: 'Narra Terminal', city: 'Narra', lat: 9.2688, lng: 118.4085 },
  { code: 'BRK', name: "Brooke's Point Terminal", city: "Brooke's Point", lat: 8.7757, lng: 117.8348 },
];

// Minutes from Puerto Princesa. Every route runs from or to the hub.
const DURATION_FROM_HUB = { ELN: 330, TAY: 240, RXS: 150, SVC: 210, NAR: 120, BRK: 210 };
const DISTANCE_FROM_HUB = { ELN: 238, TAY: 190, RXS: 125, SVC: 180, NAR: 95, BRK: 160 };

const OPERATOR_NAMES = [
  'Palawan Star Liner', 'Northern Palawan Express', 'Island Trans Co.', 'Sulu Sea Transit',
  'Green Coast Bus Lines', 'Honda Bay Shuttle',
];

const FIRST = [
  'Juan', 'Maria', 'Jose', 'Ana', 'Mark', 'Kristine', 'Paolo', 'Angelica', 'Rafael', 'Jasmine',
  'Carlo', 'Bea', 'Miguel', 'Camille', 'Ramon', 'Liza', 'Joel', 'Grace', 'Dennis', 'Rowena',
  'Nestor', 'Shiela', 'Arnel', 'Marites', 'Ronaldo', 'Jenny', 'Edwin', 'Aileen',
];
const LAST = [
  'Dela Cruz', 'Santos', 'Reyes', 'Garcia', 'Mendoza', 'Bautista', 'Villanueva', 'Ramos',
  'Castillo', 'Aquino', 'Fernandez', 'Navarro', 'Soriano', 'Magbanua', 'Abrina', 'Lagrada',
  'Pacheco', 'Tabangay', 'Ponce', 'Alvarez',
];
const person = () => `${pick(FIRST)} ${pick(LAST)}`;
const phone = () => `+639${int(10, 99)}${String(int(0, 9_999_999)).padStart(7, '0')}`;
const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, '');

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

const client = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const tally = {};
const count = (what, n = 1) => (tally[what] = (tally[what] ?? 0) + n);
const problems = [];

/** Fail loudly on the steps everything else depends on. */
function must(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}${result.error.details ? ` — ${result.error.details}` : ''}`);
  return result.data;
}

/** Record, don't stop, on the steps that are one row among many. */
function soft(label, error) {
  problems.push(`${label}: ${error}`);
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sign-up and sign-in share a per-IP limit; wait the window out instead of failing. */
async function withAuthRateLimit(label, attempt) {
  for (let tries = 0; ; tries++) {
    const result = await attempt();
    const limited = result.error && (result.error.status === 429 || /rate limit/i.test(result.error.message));
    if (!limited) return result;
    if (tries >= 6) throw new Error(`${label}: still rate limited after ${tries} waits.`);
    process.stdout.write(`\n    (auth rate limit reached — waiting 60s before ${label})`);
    await sleep(60_000);
  }
}

async function signIn(email, password) {
  const supabase = client();
  const { data, error } = await withAuthRateLimit(`signing in ${email}`, () =>
    supabase.auth.signInWithPassword({ email, password }),
  );
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return { supabase, token: data.session.access_token, userId: data.user.id };
}

async function fn(name, body, token) {
  const { status, body: res } = await invoke(name, body, token);
  if (!res?.success) return { error: `${res?.code ?? status} ${res?.message ?? ''}`.trim() };
  return { data: res.data };
}

const progress = (s) => process.stdout.write(s);

// ---------------------------------------------------------------------------
// 1. Admin: the platform's reference data
// ---------------------------------------------------------------------------

console.log(`\nPalaGo mock data → ${new URL(URL_).host}   (seed ${seed}, run tag ${TAG})\n`);

const admin = await signIn(adminEmail, adminPassword);
const a = admin.supabase;
const { data: adminProfile } = await a.from('profiles').select('role').eq('id', admin.userId).single();
if (adminProfile?.role !== 'SUPER_ADMIN') throw new Error(`${adminEmail} is not a SUPER_ADMIN.`);

progress('Terminals ');
const { data: existingTerminals } = await a.from('terminals').select('id, code, status');
const terminalId = {};
for (const t of TERMINALS) {
  const found = existingTerminals?.find((row) => row.code === t.code);
  if (found) {
    terminalId[t.code] = found.id;
    progress('·');
    continue;
  }
  const made = must(
    `terminal ${t.code}`,
    await a.rpc('create_terminal', {
      p_name: t.name, p_code: t.code, p_city: t.city, p_latitude: t.lat, p_longitude: t.lng,
    }),
  );
  terminalId[t.code] = made.id;
  count('terminals');
  progress('+');
}
console.log();

const operators = [];
for (const [i, baseName] of shuffle(OPERATOR_NAMES).slice(0, opts.operators).entries()) {
  const name = `${baseName} ${TAG}`;
  progress(`Operator ${name} `);
  const code = `M${TAG}${i + 1}`;
  const op = must(
    `operator ${name}`,
    await a.rpc('create_operator', {
      p_name: name,
      p_code: code,
      p_description: `Mock operator (run ${TAG}).`,
      p_contact_phone: phone(),
      p_contact_email: `${slug(baseName)}-${tag}@mock.palago.test`,
    }),
  );
  count('operators');

  // Routes: a few spokes from the hub, both directions.
  const spokes = shuffle(Object.keys(DURATION_FROM_HUB)).slice(0, int(2, 3));
  const routes = [];
  for (const spoke of spokes) {
    for (const [from, to] of [['PPS', spoke], [spoke, 'PPS']]) {
      const route = must(
        `route ${from}-${to}`,
        await a.rpc('create_route', {
          p_operator_id: op.id,
          p_origin_terminal_id: terminalId[from],
          p_destination_terminal_id: terminalId[to],
          p_duration_minutes: DURATION_FROM_HUB[spoke],
          p_distance_km: DISTANCE_FROM_HUB[spoke],
        }),
      );
      routes.push({ id: route.id, from, to, spoke, minutes: DURATION_FROM_HUB[spoke] });
      count('routes');
    }
  }
  progress(`· ${routes.length} routes `);

  const buses = [];
  for (let b = 1; b <= opts.busesPerOperator; b++) {
    const capacity = pick([24, 32, 45]);
    const bus = must(
      `bus ${b}`,
      await a.rpc('create_bus', {
        p_operator_id: op.id,
        p_plate_number: `${String.fromCharCode(65 + int(0, 25))}${String.fromCharCode(65 + int(0, 25))}${String.fromCharCode(65 + int(0, 25))} ${int(1000, 9999)}`,
        p_bus_number: `${code}-${String(b).padStart(2, '0')}`,
        p_capacity: capacity,
        p_name: `${baseName.split(' ')[0]} ${b}`,
      }),
    );
    buses.push({ id: bus.id, capacity });
    count('buses');
  }
  progress(`· ${buses.length} coaches\n`);

  operators.push({ id: op.id, code, name, baseName, routes, buses });
}

// ---------------------------------------------------------------------------
// 2. Staff accounts, each with the mock password already chosen
// ---------------------------------------------------------------------------

/** manage-staff issues a temporary password; sign in once and choose the real one. */
async function provision(creatorToken, body) {
  const made = await fn('manage-staff', { action: 'create', ...body }, creatorToken);
  if (made.error) throw new Error(`creating ${body.email}: ${made.error}`);
  const session = await signIn(body.email, made.data.temporaryPassword);
  const { error: pwError } = await session.supabase.auth.updateUser({ password: PASSWORD });
  if (pwError) throw new Error(`setting the password of ${body.email}: ${pwError.message}`);
  must(`mark_password_changed for ${body.email}`, await session.supabase.rpc('mark_password_changed'));
  count('staff accounts');
  return { ...made.data, session };
}

const inTwoYears = new Date(Date.now() + 2 * 365 * 86_400_000).toISOString().slice(0, 10);

for (const op of operators) {
  const prefix = `${slug(op.baseName).slice(0, 12)}-${tag}`;
  progress(`Staff for ${op.name} `);
  op.admin = await provision(admin.token, {
    email: `${prefix}-admin@mock.palago.test`,
    fullName: person(),
    role: 'OPERATOR_ADMIN',
    operatorId: op.id,
    phone: phone(),
  });
  progress('· admin ');

  // One driver and one crew member per coach, so each coach keeps its own crew
  // and a roster can never clash.
  for (const [b, bus] of op.buses.entries()) {
    const driver = await provision(op.admin.session.token, {
      email: `${prefix}-driver${b + 1}@mock.palago.test`,
      fullName: person(),
      role: 'DRIVER',
      operatorId: op.id,
      phone: phone(),
      licenseNumber: `N${int(10, 99)}-${int(10, 99)}-${int(100000, 999999)}`,
      licenseExpirationDate: inTwoYears,
    });
    const crew = await provision(op.admin.session.token, {
      email: `${prefix}-crew${b + 1}@mock.palago.test`,
      fullName: person(),
      role: 'CREW',
      operatorId: op.id,
      phone: phone(),
    });
    bus.driverId = driver.crewId;
    bus.crewId = crew.crewId;
    progress('· driver+crew ');
  }
  console.log();
}

// ---------------------------------------------------------------------------
// 3. Schedules: each coach does an out-and-back on its route every day
// ---------------------------------------------------------------------------

const hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const dateIn = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const trips = [];
for (const op of operators) {
  progress(`Schedules for ${op.name} `);
  const outbound = op.routes.filter((r) => r.from === 'PPS');
  for (const [b, bus] of op.buses.entries()) {
    const out = outbound[b % outbound.length];
    const back = op.routes.find((r) => r.from === out.spoke && r.to === 'PPS');
    // Stagger departures so the terminal is not emptied at one minute.
    const departOut = 5 * 60 + b * 45 + int(0, 3) * 15;
    // Leave well past the 30-minute turnaround buffer.
    const departBack = departOut + out.minutes + 60 + int(0, 2) * 30;

    for (let day = 1; day <= opts.days; day++) {
      const date = dateIn(day);
      for (const [leg, route, depart] of [['A', out, departOut], ['B', back, departBack]]) {
        if (depart + route.minutes >= 24 * 60) continue; // keep every mock trip same-day
        const fare = Math.round((route.minutes * 1.8) / 5) * 500; // ~₱108 an hour, in 5-peso steps
        const made = await a.rpc('create_trip', {
          p_route_id: route.id,
          p_bus_id: bus.id,
          p_trip_number: `${op.code}-${date.slice(5).replace('-', '')}-${b + 1}${leg}`,
          p_departure_date: date,
          p_departure_time: hhmm(depart),
          p_arrival_time: hhmm(depart + route.minutes),
          p_fare: fare,
          p_operator_id: op.id,
        });
        if (made.error) {
          soft(`trip ${op.code} bus ${b + 1} ${date} ${leg}`, made.error.message);
          continue;
        }
        count('trips');
        const assigned = await op.admin.session.supabase.rpc('assign_trip_crew', {
          p_trip_id: made.data.id,
          p_driver_id: bus.driverId,
          p_assistant_id: bus.crewId,
        });
        if (assigned.error) soft(`crew for ${made.data.id}`, assigned.error.message);
        else count('crew assignments');
        trips.push({ id: made.data.id, operator: op, fare, capacity: bus.capacity });
      }
    }
    progress('·');
  }
  console.log();
}

if (trips.length === 0) throw new Error('No trips were created, so there is nothing to book.');

// ---------------------------------------------------------------------------
// 4. Passengers and what they do
// ---------------------------------------------------------------------------

async function payByMockProvider(session, bookingId) {
  const created = await fn('create-test-payment', { bookingId }, session.token);
  if (created.error) return soft(`payment for ${bookingId}`, created.error);
  const token = new URL(created.data.paymentUrl).searchParams.get('t');
  const confirmed = await fn('confirm-test-payment', { reference: created.data.reference, token }, session.token);
  if (confirmed.error) return soft(`confirming ${created.data.reference}`, confirmed.error);
  count('payments (mock provider)');
  return confirmed.data;
}

function passengerList(holderName) {
  const size = pick([1, 1, 1, 2, 2, 3, 4]);
  return Array.from({ length: size }, (_, i) => ({
    name: i === 0 ? holderName : person(),
    type: i > 0 && rand() < 0.3 ? 'CHILD' : 'ADULT',
  }));
}

progress('Passengers ');
for (let p = 1; p <= opts.passengers; p++) {
  const fullName = person();
  const email = `${slug(fullName)}.${tag}${p}@mock.palago.test`;
  const supabase = client();
  const signedUp = await withAuthRateLimit(`signing up ${email}`, () =>
    supabase.auth.signUp({
      email,
      password: PASSWORD,
      options: { data: { full_name: fullName, phone: phone() } },
    }),
  );
  if (signedUp.error || !signedUp.data.session) {
    soft(
      `sign-up ${email}`,
      signedUp.error?.message ?? 'no session returned — e-mail confirmation is on for this project',
    );
    continue;
  }
  count('passenger accounts');
  const session = { supabase, token: signedUp.data.session.access_token };

  // Half of them keep money in the wallet.
  let wallet = 0;
  if (rand() < 0.5) {
    const amount = pick([50_000, 100_000, 200_000, 300_000]);
    const topped = await supabase.rpc('top_up_wallet', { p_amount: amount, p_idempotency_key: `mock-${tag}-${p}` });
    if (topped.error) soft(`top-up for ${email}`, topped.error.message);
    else {
      wallet = amount;
      count('wallet top-ups');
    }
  }

  for (let n = 0; n < int(1, 3); n++) {
    const trip = pick(trips);
    const booked = await supabase.rpc('create_booking', {
      p_trip_id: trip.id,
      p_passengers: passengerList(fullName),
      p_seat_ids: null,
      p_walk_in: false,
      p_source: 'MOBILE_APP',
      p_ticket_type: 'DIGITAL',
    });
    if (booked.error) {
      soft(`booking on ${trip.id}`, booked.error.message);
      continue;
    }
    count('bookings');
    const { bookingId, totalAmount } = booked.data;

    const roll = rand();
    if (roll < 0.15) {
      // Changed their mind before paying.
      const cancelled = await supabase.rpc('cancel_booking', { p_booking_id: bookingId });
      if (cancelled.error) soft(`cancel ${bookingId}`, cancelled.error.message);
      else count('bookings cancelled');
    } else if (roll < 0.25) {
      count('bookings left unpaid'); // the hold lapses on its own after ten minutes
    } else if (wallet >= totalAmount && rand() < 0.6) {
      const paid = await supabase.rpc('pay_booking_with_wallet', { p_booking_id: bookingId });
      if (paid.error) soft(`wallet payment ${bookingId}`, paid.error.message);
      else {
        wallet -= totalAmount;
        count('payments (wallet)');
      }
    } else {
      await payByMockProvider(session, bookingId);
    }
  }
  progress('·');
}
console.log();

// ---------------------------------------------------------------------------
// 5. Walk-ins sold at each operator's counter, paid in cash
// ---------------------------------------------------------------------------

progress('Counter sales ');
for (const op of operators) {
  const own = trips.filter((t) => t.operator === op);
  const clerk = op.admin.session.supabase;
  for (let n = 0; n < int(2, 4); n++) {
    const trip = pick(own);
    const walkIn = await clerk.rpc('create_booking', {
      p_trip_id: trip.id,
      p_passengers: Array.from({ length: pick([1, 1, 2]) }, () => ({ name: person(), type: 'ADULT' })),
      p_seat_ids: null,
      p_walk_in: true,
      p_source: 'OPERATOR',
      p_ticket_type: 'PRINTED',
    });
    if (walkIn.error) {
      soft(`walk-in on ${trip.id}`, walkIn.error.message);
      continue;
    }
    count('bookings');
    const cash = await clerk.rpc('record_counter_payment', { p_booking_id: walkIn.data.bookingId, p_method: 'CASH' });
    if (cash.error) soft(`cash for ${walkIn.data.bookingId}`, cash.error.message);
    else count('payments (counter cash)');
    progress('·');
  }
}
console.log();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\nCreated');
for (const [what, n] of Object.entries(tally)) console.log(`  ${String(n).padStart(5)}  ${what}`);

console.log(`\nSign in with any of these (password ${process.env.MOCK_PASSWORD ? '$MOCK_PASSWORD' : PASSWORD}):`);
for (const op of operators) {
  console.log(`  ${op.name}`);
  console.log(`    operator admin  ${op.admin.email}`);
}
console.log(`  drivers / crew / passengers: …-${tag}…@mock.palago.test`);

if (problems.length > 0) {
  console.log(`\n${problems.length} step(s) were refused:`);
  for (const p of problems.slice(0, 20)) console.log(`  - ${p}`);
  if (problems.length > 20) console.log(`  … and ${problems.length - 20} more`);
  process.exitCode = 1;
}
console.log();
