/**
 * Is the hosted project actually usable by a local app?
 *
 *   pnpm cloud:check
 *
 * Pointing `pnpm web` at Supabase Cloud instead of the Docker stack is a
 * one-line change — `.env` already does it — and then four other things have to
 * be true or the app looks broken in ways that do not name their own cause:
 *
 *   * a schema older than the client makes a search return "Could not load
 *     trips", because the client asks for a column by name;
 *   * no Edge Functions makes every payment, boarding scan and staff
 *     provisioning fail, while browsing works fine;
 *   * no QR_SIGNING_SECRET makes the boarding pass fail closed — correctly,
 *     and silently as far as the screen is concerned;
 *   * an empty database renders a working app with nothing in it, which reads
 *     as a bug rather than as "nobody has added a bus yet".
 *
 * This checks all four and says which command fixes each. Read-only: it lists
 * and counts, and writes nothing to anybody's project.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function readDotEnv() {
  const file = path.join(root, '.env');
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

function cli(args, timeout = 120_000) {
  return execFileSync('pnpm', ['exec', 'supabase', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    shell: process.platform === 'win32',
  });
}

/** The CLI prints one JSON object on its own line, after human-readable noise. */
function lastJson(raw, key) {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith('{') && l.includes(`"${key}"`));
  return line ? JSON.parse(line) : null;
}

const env = readDotEnv();
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error('EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set in .env.');
  process.exit(1);
}

const host = new URL(url).hostname;
const isLocal = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host);

console.log(`\n  The app is pointed at ${host}\n`);

if (isLocal) {
  console.log('  That is the Docker stack, not Supabase Cloud. To use the hosted project, set');
  console.log('  EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env to the');
  console.log('  values from the Supabase dashboard (Project Settings -> API).\n');
  process.exit(0);
}

const todo = [];
const ok = (label) => console.log(`  ok    ${label}`);
const missing = (label, fix) => {
  console.log(`  MISS  ${label}`);
  todo.push(fix);
};

// --- 1. schema -------------------------------------------------------------
try {
  const migrations = lastJson(cli(['migration', 'list', '--linked']), 'migrations')?.migrations ?? [];
  const behind = migrations.filter((m) => m.local && !m.remote);
  if (behind.length === 0) {
    ok(`schema — all ${migrations.length} migrations applied`);
  } else {
    missing(
      `schema — ${behind.length} migration(s) not applied`,
      `SUPABASE_PROJECT_REF=${env.SUPABASE_PROJECT_REF ?? '<ref>'} pnpm db:push:prod -- --yes`,
    );
  }
} catch (error) {
  missing(`schema — could not read migration state (${String(error.message).split('\n')[0]})`,
    'supabase link --project-ref <ref>');
}

// --- 2. Edge Functions -----------------------------------------------------
// Everything privileged goes through these: confirming a payment, issuing a
// boarding pass, provisioning staff. Without them the app browses and cannot act.
const EXPECTED = fs
  .readdirSync(path.join(root, 'supabase', 'functions'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => d.name);

try {
  const raw = cli(['functions', 'list']);
  const deployed = (lastJson(raw, 'functions')?.functions ?? []).map((f) => f.slug ?? f.name);
  const absent = EXPECTED.filter((name) => !deployed.includes(name));
  if (absent.length === 0) ok(`edge functions — all ${EXPECTED.length} deployed`);
  else
    missing(
      `edge functions — ${absent.length} of ${EXPECTED.length} not deployed (${absent.join(', ')})`,
      'supabase functions deploy',
    );
} catch (error) {
  missing(`edge functions — could not list (${String(error.message).split('\n')[0]})`, 'supabase functions deploy');
}

// --- 3. secrets ------------------------------------------------------------
// The functions fail closed without these, which is right and invisible.
const REQUIRED_SECRETS = ['QR_SIGNING_SECRET', 'PAYMENT_PROVIDER', 'WEB_PAYMENT_BASE_URL'];
try {
  const names = (lastJson(cli(['secrets', 'list']), 'secrets')?.secrets ?? []).map((s) => s.name);
  const absent = REQUIRED_SECRETS.filter((n) => !names.includes(n));
  if (absent.length === 0) ok(`function secrets — all ${REQUIRED_SECRETS.length} set`);
  else
    missing(
      `function secrets — missing ${absent.join(', ')}`,
      'supabase secrets set QR_SIGNING_SECRET=<32+ random chars> PAYMENT_PROVIDER=mock WEB_PAYMENT_BASE_URL=' +
        (env.EXPO_PUBLIC_WEB_PAYMENT_BASE_URL ?? '<deployed-origin>'),
    );
} catch (error) {
  missing(`function secrets — could not list (${String(error.message).split('\n')[0]})`, 'supabase secrets set ...');
}

// --- 4. something to look at ----------------------------------------------
// `operators`, `terminals` and `routes` are world-readable because trip search
// needs them, so the publishable key can count them without signing in.
async function count(table) {
  const response = await fetch(`${url}/rest/v1/${table}?select=id`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const range = response.headers.get('content-range');
  const total = range?.split('/')?.[1];
  return total && total !== '*' ? Number(total) : (await response.json()).length;
}

const counts = {};
for (const table of ['operators', 'terminals', 'routes', 'buses', 'trips']) {
  counts[table] = await count(table);
}

if (counts.operators > 0 && counts.routes > 0 && counts.trips > 0) {
  ok(
    `data — ${counts.operators} operator(s), ${counts.routes} route(s), ${counts.trips} trip(s)`,
  );
} else {
  missing(
    `data — ${counts.operators ?? '?'} operator(s), ${counts.routes ?? '?'} route(s), ` +
      `${counts.buses ?? '?'} coach(es), ${counts.trips ?? '?'} trip(s)`,
    'see docs/deployment.md -> "Developing against the hosted project"',
  );
}

// ---------------------------------------------------------------------------

if (todo.length === 0) {
  console.log('\n  The hosted project is ready. `pnpm web` will use it.\n');
} else {
  console.log('\n  To finish:\n');
  for (const fix of todo) console.log(`    ${fix}`);
  console.log('');
}

// A caveat no amount of setup removes, so it is printed either way.
console.log('  Note: `pnpm db:verify:all` still needs Docker. The suites write bookings,');
console.log('  payments and test money, so scripts/_verify-env.mjs refuses any target that is');
console.log('  not localhost unless VERIFY_ALLOW_REMOTE=1 — which would write all of that into');
console.log(`  ${host}. Keep the local stack for verification even when the app talks to cloud.\n`);

process.exit(todo.length === 0 ? 0 : 1);
