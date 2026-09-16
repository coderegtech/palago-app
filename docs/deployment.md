# Deployment — web on Vercel, apps on EAS

Vercel hosts **the web build only**: the passenger and operator screens as a single-page app, plus
the public `/payment/[reference]` page. It does not host the backend. Postgres, Auth, Realtime and
the Edge Functions all live in the Supabase project, and Vercel talks to them from the browser.

> **This is still a mock-payment build, and the TEST labels are gone.** Putting it on a real domain
> changes nothing about what it charges — nothing — but a stranger who lands on a receipt now has no
> on-screen way to tell. See the non-negotiables in [AGENTS.md](../AGENTS.md) before pointing a
> public link at this. Full production readiness is Phase 15, not this document.

## What is in the repository

| File | Purpose |
|---|---|
| `vercel.json` | Build command, output directory, the SPA rewrite, cache and security headers |
| `.vercelignore` | Keeps `supabase/`, `docs/` and local state out of the upload — none of it reaches Metro |
| `package.json` → `build:web` | `expo export --platform web`, which writes `dist/` |
| `package.json` → `packageManager`, `engines.node` | Pin pnpm to 10.30.3 (the version that generated the lockfile) and require Node 20+. The Node range is deliberately not a single major — pinning `22.x` makes pnpm warn on every local command on a machine running anything newer |

`dist/` is git-ignored. Vercel builds it; it is never committed.

## The rewrite is load-bearing

`app.json` sets `web.output: "single"`, so the export produces exactly one `index.html` and routing
happens in the browser. `vercel.json` therefore rewrites every unmatched path to `/index.html`:

```json
{ "source": "/(.*)", "destination": "/index.html" }
```

Vercel checks the filesystem before applying a rewrite, so the hashed bundles under `/_expo/static/`
and `/assets/` are still served as real files — which is what makes the `immutable` cache headers on
them safe.

Without the rewrite, `/payment/PAY-2026-000001` — the URL inside every payment QR code — returns a
404 from the CDN and never reaches the router. That is the same failure mode as switching
`web.output` away from `single`, and it is the one to check first if scanned QR codes stop working.

## Environment variables

Set these in **Project Settings → Environment Variables**, for Production and Preview both. They are
read at *build* time: Babel inlines every `EXPO_PUBLIC_*` value into the bundle, so changing one
requires a redeploy, not just a restart.

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The project's publishable / anon key |
| `EXPO_PUBLIC_PAYMENT_PROVIDER` | `mock` — `src/lib/env.ts` rejects anything else |
| `EXPO_PUBLIC_WEB_PAYMENT_BASE_URL` | The deployed origin, e.g. `https://palago.vercel.app` |
| `EXPO_PUBLIC_MAP_STYLE_URL` | `https://tiles.openfreemap.org/styles/liberty` |

Everything here is public by definition — it ships inside the JavaScript bundle. The service-role
key and `QR_SIGNING_SECRET` belong in Supabase Edge Function secrets and must never be added to
Vercel.

`src/lib/env.ts` validates all five on import and throws at startup if one is missing, so a
misconfigured deployment fails visibly on first load rather than as a confusing fetch error later.

### `EXPO_PUBLIC_WEB_PAYMENT_BASE_URL` does two jobs

It is the base of the payment URL encoded in the QR, *and* the redirect base for password recovery
(`use-auth-mutations.ts` sends `${webPaymentBaseUrl}/reset-password`). Both consequences:

- It must be the **deployed origin**, not `127.0.0.1:8090`. A production build carrying the
  localhost value emits QR codes that resolve to the scanner's own phone.
- That origin must be added to **Supabase → Authentication → URL Configuration**, as the Site URL
  and in Redirect URLs. Supabase refuses to redirect to an origin that is not on the allowlist, so
  password reset silently fails without it.

Preview deployments get a different hostname on every push. Those hostnames are not on the Supabase
allowlist and do not match the baked-in `EXPO_PUBLIC_WEB_PAYMENT_BASE_URL`, so **auth redirects and
payment QR codes only work correctly on the production URL** unless a preview hostname is added
deliberately.

## The database goes first, and there is a check for it

```bash
pnpm deploy:check
```

Refuses to ship a client the linked project cannot serve, and names the migrations that are missing.

This is not hypothetical. Browser-verifying Phase 14 produced "Could not load trips" on every
search. The client was right and the query was right — `trip_search` simply had no
`operator_status` column on the hosted project, because `20260915000032` had never been applied
there. `EXPO_PUBLIC_*` values are baked in at build time and the dev server reads `.env`, which
points at the hosted project, so a schema three migrations behind looked exactly like a broken
feature for a good while.

The asymmetry is the whole rule. **A client ahead of its database fails closed** — it asks for a
column by name, gets nothing, and takes the screen with it. **A database ahead of its client is
harmless** — nothing reads the new column until the new build lands. So deploy in one order, every
time: migrations, then functions, then the client.

The more serious version of the same mistake: at the time of writing the linked project was also
missing `20260916000033`, the Phase 13 write-scope fix — so production still allowed an operator to
hard-delete a trip and to roster a rival company's driver. A security migration that was written,
tested and never applied protects nobody.

## Backend deployment is separate

Vercel deploys nothing in `supabase/`. When the schema or a function changes:

```bash
SUPABASE_PROJECT_REF=<ref> pnpm db:push:prod -- --yes
supabase functions deploy
```

`db:push:prod` applies `supabase/migrations/` and nothing else. **`supabase/seed.sql` must never
reach a hosted project** — it creates seven accounts that share one password, along with test trips
and test money. See [database.md](database.md).

Edge Function secrets are set once per project and are not in this repository:

```bash
supabase secrets set QR_SIGNING_SECRET=<32+ chars> PAYMENT_PROVIDER=mock WEB_PAYMENT_BASE_URL=https://<deployed-origin>
```

The functions fail closed without `QR_SIGNING_SECRET`, which is the intended behaviour — an
unsigned boarding pass is worse than none.

## First deploy

1. Import the repository at [vercel.com/new](https://vercel.com/new). Framework preset: **Other** —
   `vercel.json` supplies the commands, and letting Vercel guess "Expo" makes it look for a
   `build` script that does not exist.
2. Add the five environment variables above. Set `EXPO_PUBLIC_WEB_PAYMENT_BASE_URL` to the origin
   Vercel is about to assign; if you do not know it yet, deploy once, then set it and redeploy —
   the value is baked into the bundle, so the first deploy will have the wrong one.
3. Add that origin to Supabase's Auth URL configuration.
4. Deploy, then check `/payment/<any-reference>` loads the payment page rather than a 404. That one
   request exercises the rewrite, the bundle and the env validation together.

## Things that will bite

- **The entry bundle is ~5.6 MB uncompressed.** Vercel serves it gzipped and it is content-hashed
  and immutable, so it is a one-time cost per deploy — but it is the number to watch if the first
  paint gets slow. Phase 15 owns this.
- **MapLibre is native-only.** The `map.tsx` / `map.web.tsx` split is what keeps it out of the web
  bundle. Importing MapLibre into a file the web build reaches breaks the export, and the public
  payment page with it.
- **`pnpm install --frozen-lockfile` is the install command**, matching CI. A `package.json` change
  committed without a regenerated `pnpm-lock.yaml` fails the build rather than silently drifting.
  `pnpm-workspace.yaml` and `.npmrc` are both tracked and both required — `.npmrc` public-hoists
  `react-native-css-interop`, without which the bundle fails to resolve `jsx-runtime`.

---

# Android builds

## The app closed itself on launch, and this is why

An APK built from the `preview` profile installed, showed the splash screen, and exited. No crash
dialog, no message. The cause was not in the app code:

- `.gitignore:57` ignores `.env*`, and **EAS uploads only what git tracks** — so `.env` never
  reached the build server. Only `.env.example` did.
- `eas.json` declared no `env` and no `environment` for any profile, so there was nothing to fall
  back on.
- Every `EXPO_PUBLIC_*` value therefore inlined as `undefined`.
- `src/lib/env.ts` validates all five on import and throws. The root layout reaches it during module
  evaluation — `_layout.tsx` → `AppProviders` → `useAuthBootstrap` → `@/lib/supabase` → `@/lib/env`
  — which is **before React renders and before any error boundary exists**. A release build has no
  red screen, and `SplashScreen.preventAutoHideAsync()` has already hidden the empty view behind the
  splash. The process simply ends.

The throw is correct and stays. What was missing was any way to see it.

## Confirming it on a device

```bash
adb logcat -c && adb logcat *:E ReactNative:V ReactNativeJS:V | grep -i "palago\|misconfigured"
```

Launch the app while that is running. A configuration failure prints
`PalaGo is misconfigured. Copy .env.example to .env and fill it in.` followed by the specific
variables. Anything else — a missing native module, a MapLibre failure — shows up here too, so this
is the first command to run for any silent exit, not just this one.

## The fix: give the build its variables

`eas.json` now sets the two constants inline and links each profile to an **EAS environment** of the
same name for the three values that differ per deployment:

| Variable | Where it lives | Why |
|---|---|---|
| `EXPO_PUBLIC_PAYMENT_PROVIDER` | inline in `eas.json` | Always `mock`. Not a secret, not per-environment. |
| `EXPO_PUBLIC_MAP_STYLE_URL` | inline in `eas.json` | OpenFreeMap needs no key. |
| `EXPO_PUBLIC_SUPABASE_URL` | EAS environment | Identifies the project; `.gitignore` says not to commit it. |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | EAS environment | Same. |
| `EXPO_PUBLIC_WEB_PAYMENT_BASE_URL` | EAS environment | Differs per deployment, and **must not be localhost**. |

Create them once per environment (`development`, `preview`, `production`):

```bash
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://<project-ref>.supabase.co --visibility plaintext --non-interactive
```

```bash
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value sb_publishable_xxxxxxxx --visibility plaintext --non-interactive
```

```bash
eas env:create --environment preview --name EXPO_PUBLIC_WEB_PAYMENT_BASE_URL --value https://<deployed-origin> --visibility plaintext --non-interactive
```

`--visibility plaintext` is right for all three: every `EXPO_PUBLIC_*` value is inlined into the
bundle and is readable by anyone who unzips the APK. Marking them `secret` would hide them from the
EAS dashboard while shipping them in the download — a false sense of safety, not a real one. Nothing
that must stay private may be an `EXPO_PUBLIC_*` variable at all; those go in Supabase Edge Function
secrets.

Check what a profile will actually receive:

```bash
eas env:list --environment preview
```

## Do not copy `.env` into EAS unchanged

`.env` is a **local development** file. Two of its values are wrong for an APK:

- `EXPO_PUBLIC_WEB_PAYMENT_BASE_URL=http://127.0.0.1:8090` — inside an APK, `127.0.0.1` is the
  phone. Payment QR codes would encode a URL resolving to the scanner's own handset, and password
  recovery links would go nowhere. Use the deployed origin, and add it to **Supabase →
  Authentication → URL Configuration** (see the web section above).
- `EXPO_PUBLIC_SUPABASE_URL` pointing at `127.0.0.1:54321` has the same problem if `.env` is
  currently aimed at the local stack. A device needs the hosted project, or the machine's LAN
  address for a development build.

## The build now fails instead of shipping a broken app

`scripts/check-build-env.mjs` runs as the `eas-build-pre-install` hook — on the EAS builder, before
install and before bundling. It refuses the build when a required variable is missing, when a URL is
not a URL, when a non-development profile points at localhost or a private LAN range, when
`EXPO_PUBLIC_PAYMENT_PROVIDER` is anything but `mock`, or when the publishable key looks like a
secret key.

npm never runs it locally: `eas-build-pre-install` is an EAS hook name, not an npm lifecycle event.

A silent exit on a tester's phone is the most expensive place to find a missing variable. A failed
build that names it is the cheapest.

## Building

```bash
pnpm build:apk
```

`eas build --profile preview --platform android` — an installable APK, distributed internally.
`preview` sets `buildType: "apk"` deliberately; the `production` profile produces an AAB for Play,
which cannot be sideloaded.

```bash
pnpm build-dev:android
```

The development client, for running Metro against a device.

## Still to verify on hardware

MapLibre has never run on a real device — it typechecks against the v11 API, which is not the same
thing. Push delivery is likewise unproven. Both need this APK on a handset; neither can fail at
startup, so they will not reproduce the symptom above.
