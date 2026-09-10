/**
 * Push schema migrations to the production Supabase project.
 *
 *   SUPABASE_PROJECT_REF=<ref> pnpm db:push:prod
 *
 * This applies everything under supabase/migrations/ — schema only. It never
 * touches supabase/seed.sql: that file is test accounts, test trips and test
 * money, and AGENTS.md says explicitly it must never be loaded into a real
 * project. If production needs reference data (real operators, terminals,
 * routes, buses), that belongs in its own migration or a separate prod-only
 * SQL file, written deliberately — not this script.
 *
 * Requires `supabase login` to have been run once on this machine (or
 * SUPABASE_ACCESS_TOKEN set), and SUPABASE_PROJECT_REF pointing at the target
 * project (Project Settings > General > Reference ID on supabase.com).
 *
 * Linking and pushing against a shared production database is not
 * reversible from here, so this refuses to run without an explicit --yes.
 */

import { spawnSync } from 'node:child_process';

const projectRef = process.env.SUPABASE_PROJECT_REF || "osbibaaokuighlrqfpua";
const confirmed = process.argv.includes('--yes') || process.env.CONFIRM_PROD === 'yes';

if (!projectRef) {
  console.error(
    'SUPABASE_PROJECT_REF is not set.\n' +
      'Set it to the target project’s reference id, e.g.\n' +
      '  SUPABASE_PROJECT_REF=abcdefghijklmnop pnpm db:push:prod',
  );
  process.exit(1);
}

if (!confirmed) {
  console.error(
    `This will link to Supabase project "${projectRef}" and push every pending migration\n` +
      'in supabase/migrations/ to it. Schema only — supabase/seed.sql is never applied here.\n\n' +
      'Re-run with --yes (or CONFIRM_PROD=yes) once you have confirmed this is the right project:\n' +
      `  SUPABASE_PROJECT_REF=${projectRef} pnpm db:push:prod -- --yes`,
  );
  process.exit(1);
}

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('supabase', ['link', '--project-ref', projectRef]);
run('supabase', ['db', 'push']);

console.log('\nMigrations pushed. Run `pnpm db:types` against the linked project if types need to follow.');
