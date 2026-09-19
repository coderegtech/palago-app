/**
 * The production web export, tree-shaken.
 *
 *   pnpm build:web
 *
 * A script rather than `VAR=1 expo export` in package.json because pnpm runs
 * scripts through cmd.exe on Windows, where that syntax does not exist.
 *
 * Both flags only take effect in a production export. `metro.config.js`
 * switches on `experimentalImportSupport` when it sees the second one, which
 * is what lets Metro drop unused exports. Measured on the login page: 5.9 MB
 * of JavaScript before, 2.7 MB after (docs/performance.md).
 */

import { spawnSync } from 'node:child_process';

const result = spawnSync('pnpm', ['exec', 'expo', 'export', '--platform', 'web', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH: '1',
    EXPO_UNSTABLE_TREE_SHAKING: '1',
  },
});

process.exit(result.status ?? 1);
