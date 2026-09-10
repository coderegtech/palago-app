# Deployment — web on Vercel

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
