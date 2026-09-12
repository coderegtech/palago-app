/**
 * Where the verify-*.mjs suites point — and why it is never production.
 *
 * Every suite signs in as the seeded test accounts and then *writes*: bookings,
 * payments, wallet top-ups, loyalty points, boarding scans. They used to read
 * `.env` straight from disk, so if `.env` pointed at the hosted project —
 * which it does whenever the app is being tested against it — `pnpm
 * db:verify:all` wrote test money into production.
 *
 * The rule now:
 *
 *   * `.env` (or the shell) points at localhost  →  use it.
 *   * `.env` points anywhere else                →  ignore it and target the
 *     local stack, reading its URL and key from `supabase status`. Nobody has to
 *     swap `.env` back and forth, and forgetting to swap it back does no harm.
 *   * Running against a remote project needs `VERIFY_ALLOW_REMOTE=1`, said out
 *     loud, every time.
 */

import { execSync } from 'node:child_process';
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

function isLocal(url) {
  try {
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function localStack() {
  let raw;
  try {
    raw = execSync('pnpm exec supabase status -o json', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error('The local Supabase stack is not running. Start it with `pnpm db:start`.');
  }
  const status = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  if (!status.API_URL || !key) throw new Error('`supabase status` did not report an API URL and key.');
  return { url: status.API_URL, key };
}

let cached;

/** `{ url, key }` for the suite to use. Prints the target once. */
export function loadVerifyEnv() {
  if (cached) return cached;

  const file = readDotEnv();
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? file.EXPO_PUBLIC_SUPABASE_URL;
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? file.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (url && isLocal(url) && key) {
    cached = { url, key };
  } else if (process.env.VERIFY_ALLOW_REMOTE === '1' && url && key) {
    console.warn(`\n  !! VERIFY_ALLOW_REMOTE=1 — writing test data to ${new URL(url).host}\n`);
    cached = { url, key };
  } else {
    cached = localStack();
    if (url && !isLocal(url)) {
      console.log(`  (.env points at ${new URL(url).host}; verifying against the local stack instead)`);
    }
  }
  return cached;
}
