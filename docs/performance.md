# Performance

The Phase 15 performance work. Three problems were named in
[production-costs.md](production-costs.md) §8; each is below with what was measured, what changed,
and what is still unproven.

## 1. The web bundle

**Measured**, with `expo export --platform web` served locally and the JavaScript a browser actually
downloaded read from `performance.getEntriesByType('resource')`:

| Build | Login page JS | Public payment page JS |
|---|---|---|
| Before — one unsplit `entry.js` | 5,909 KB | — (same single file) |
| Async routes only | 5,576 KB | — |
| Tree shaking only | 3,029 KB | 3,029 KB |
| **Tree shaking + async routes (shipped)** | **2,692 KB** | **2,699 KB** |

**−54 %.** Source maps showed why the first attempt, route splitting on its own, barely helped:
every page still loaded a 3.5 MB shared chunk, and the largest thing in it was
`lucide-react-native` — 1.6 MB of source, because without tree shaking every icon in the set ships.
Next were `expo-router` (1.2 MB), app code (0.9 MB), `zod` (0.8 MB), Reanimated and
react-native-web (0.7 MB each).

**What changed:**

- `pnpm build:web` runs `scripts/build-web.mjs`, which sets `EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH=1`
  and `EXPO_UNSTABLE_TREE_SHAKING=1`; `metro.config.js` switches on `experimentalImportSupport` and
  `inlineRequires` only when it sees the second. A script, not `VAR=1 expo export` in
  `package.json`, because pnpm runs scripts through cmd.exe on Windows.
- `app.json` enables async routes for **web only** (`"asyncRoutes": { "web": true, "default":
  false }`). The SDK 57 docs call web support complete and native production unsupported. Each
  screen is now its own chunk, fetched on first navigation — verified by clicking from `/login` to
  `/register` in the exported build and watching `register-*.js` arrive.

**Verified in the exported build:** login renders styled (NativeWind survives tree shaking), the
public payment page renders a live payment logged-out with no console errors, lazy navigation
works, and `expo export --platform android` still bundles.

**Why tree shaking is web-only for now.** It is marked experimental in SDK 57, and it changes module
semantics (`experimentalImportSupport`) — the kind of change that looks perfect in a browser and
breaks on a handset, which this project has been bitten by before (AGENTS.md: `h-full`, nested
Pressables). It is off for `pnpm web`, `pnpm android` and EAS builds until someone runs a
tree-shaken APK. To try it there: set both variables in the EAS profile's `env`.

**Not done:** replacing `zod` with `zod/mini` on the client, and the icon set with per-icon imports
(tree shaking made the second mostly moot).

## 2. GPS pings

**Found:** `watchPositionAsync`'s `timeInterval` is Android-only. iOS ignores it and reports a fix
every `distanceInterval` (25 m) — at highway speed more than one `bus_locations` insert a second,
each fanned out over Realtime to every passenger watching.

**Changed:**

- The publisher throttles itself (`src/utils/location-throttle.ts`, `shouldPublishFix`), keyed on
  the last *attempt*, so a failed ping is retried by the next fix after the interval and never by a
  burst. Unit-tested, including the one-fix-a-second case and a clock that jumps backwards.
- `LOCATION_UPDATE_INTERVAL_MS` 10 s → 20 s — the cost doc's own recommendation. A coach moves about
  450 m in that time at highway speed, invisible on a province-scale map. Rows and Realtime
  messages per trip halve.
- `LOCATION_STALE_AFTER_MS` is now a fixed two minutes instead of "six intervals", so tuning the
  interval no longer silently changes when a passenger is told the position is old.

**Unproven:** none of this has run on a handset (the same gap Phase 8 records).

## 3. `bus_locations` retention

**Found:** nothing ever deleted a GPS row; ~1.3 GB a month at province-wide scale.

**Changed** (`20260919000039_bus_location_retention.sql`): `prune_bus_locations()` thins the trail
of every trip that has ended (COMPLETED, ARRIVED or CANCELLED) and departed more than
`bus_location_retention_days` ago (`app_settings`, default 30) to its single final fix. It runs
nightly from **pg_cron** at 03:15 Palawan time, deletes in batches of 20,000 so a first run over a
backlog does not hold one long lock, and is revoked from every client role.

**Verified** in a rolled-back transaction on the local stack, with the seeded trips backdated
40 days: the ended trip's four points became one, and it was the latest; a trip still running
(DEPARTED) kept all of its points despite its old date; batching looped correctly with a batch size
of 2; a second run deleted nothing; `authenticated` was refused.

To change the window: `update public.app_settings set value = '14' where key =
'bus_location_retention_days';`. To see runs: `select * from cron.job_run_details order by
start_time desc;`.
