/**
 * Refuses to ship a client that the target database cannot serve.
 *
 *   pnpm deploy:check
 *
 * ## The failure this exists to stop
 *
 * Browser-verifying Phase 14 produced "Could not load trips" on every search.
 * The client was right and the query was right — `trip_search` simply had no
 * `operator_status` column on the hosted project, because migration
 * `20260915000032` had never been applied there. `EXPO_PUBLIC_*` values are
 * baked in at build time and the dev server reads `.env`, which points at the
 * hosted project, so a schema three migrations behind looked exactly like a
 * broken feature.
 *
 * That is the ordinary shape of the mistake: **the database goes first.** A
 * client asking for a column that does not exist yet fails closed and takes the
 * whole screen with it, whereas a database ahead of its client is harmless —
 * nothing reads the new column until the new build lands. So a deploy is safe
 * in exactly one order, and this checks it rather than trusting it.
 *
 * It also catches the more serious version. At the time of writing the hosted
 * project was missing `20260916000033`, which is the Phase 13 write-scope fix —
 * so production still allowed an operator to hard-delete a trip and to roster a
 * rival company's driver. A security migration that was written, tested and
 * never applied protects nobody.
 *
 * Read-only: it lists migrations and compares. It never applies anything.
 *
 * Requires the project to be linked (`supabase link`) and an internet
 * connection. In CI, SUPABASE_ACCESS_TOKEN must be set.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');

/** `supabase migration list --linked` prints one JSON object on its own line. */
function remoteState() {
  let raw;
  try {
    raw = execFileSync('pnpm', ['exec', 'supabase', 'migration', 'list', '--linked'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      shell: process.platform === 'win32',
    });
  } catch (error) {
    const detail = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n').trim();
    throw new Error(
      `Could not read the linked project's migration state.\n\n${detail}\n\n` +
        'Is the project linked (`supabase link`) and are you online? ' +
        'In CI, set SUPABASE_ACCESS_TOKEN.',
    );
  }

  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith('{') && l.includes('"migrations"'));

  if (!line) throw new Error(`Could not find migration JSON in the CLI output:\n${raw}`);
  return JSON.parse(line).migrations ?? [];
}

const migrations = remoteState();

/**
 * A version present locally and absent remotely. The reverse — remote-only —
 * is reported too but is not fatal: it usually means somebody applied a
 * migration from another branch, which is worth knowing about and is not a
 * reason to refuse a deploy on its own.
 */
const unapplied = migrations.filter((m) => m.local && !m.remote);
const unknownLocally = migrations.filter((m) => m.remote && !m.local);

/** The filename, so the message names something you can actually open. */
const fileFor = (version) => {
  const match = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).find((f) => f.startsWith(version))
    : undefined;
  return match ?? `${version}_*.sql`;
};

if (unknownLocally.length > 0) {
  console.log('\nApplied on the project but not in this checkout:');
  for (const m of unknownLocally) console.log(`  · ${m.remote}`);
  console.log('  Somebody deployed from another branch. Not fatal, but worth knowing.\n');
}

if (unapplied.length === 0) {
  console.log(
    `Deploy check passed: all ${migrations.length} migrations are applied to the linked project.`,
  );
  process.exit(0);
}

console.error(`
──────────────────────────────────────────────────────────────────────────
  The linked project is ${unapplied.length} migration${unapplied.length === 1 ? '' : 's'} behind this checkout.

${unapplied.map((m) => `    • ${fileFor(m.local)}`).join('\n')}

  Do not ship the client first. Every EXPO_PUBLIC_* value is baked in at
  build time and the client asks for columns by name, so a build that
  reaches a schema older than itself fails closed — a search that asks for
  a column the view does not have returns nothing and shows "Could not
  load trips", which looks like a broken feature rather than a missing
  migration. A database ahead of its client is harmless by comparison:
  nothing reads the new column until the new build lands.

  Apply them, then build:

    SUPABASE_PROJECT_REF=<ref> pnpm db:push:prod -- --yes
    supabase functions deploy

  supabase/seed.sql must never reach a hosted project — it creates seven
  accounts sharing one password, plus test trips and test money.
  db:push:prod applies supabase/migrations/ and nothing else.

  See docs/deployment.md.
──────────────────────────────────────────────────────────────────────────
`);
process.exit(1);
