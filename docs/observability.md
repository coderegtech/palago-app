# Observability — EAS Observe

Startup and navigation performance, plus crash and error reporting, from
[`expo-observe`](https://docs.expo.dev/eas/observe/get-started/). Metrics land in the **Observe** tab
of the EAS dashboard for `@coderegtech/palago-app`, or through `eas observe:metrics-summary` and
`eas observe:routes`.

This closes half of what [production-costs.md](production-costs.md) listed as the "no error
monitoring or logging" gap. The other half — deciding what to do when a metric looks wrong — is
Phase 15.

## What is wired up

| Piece | Where | Note |
|---|---|---|
| `expo-observe@57.0.22` | `package.json` | Auto-linked native module. No `app.json` plugin. |
| `Observe.configure(...)` | [`src/lib/observe.ts`](../src/lib/observe.ts) | Imported for its side effect by the root layout. |
| `ObserveRoot.wrap(RootLayout)` | [`src/app/_layout.tsx`](../src/app/_layout.tsx) | Starts the session the metrics are measured against. |
| `<ObserveInteractiveMarker />` | six entry screens | Marks TTI once the screen's data has arrived. |

## Two things that are load-bearing

### `configure` must run before the first screen mounts

`useObserve()` asserts that the router integration is not toggled during a screen's lifecycle, and
warns loudly if it is. So `Observe.configure(...)` is called at **module scope** in
`src/lib/observe.ts`, which `src/app/_layout.tsx` imports for its side effect on its second line —
not inside a `useEffect`, which would run after the first screen had already mounted.

### Route parameters are filtered, deliberately

The `expo-router` integration exports `routeParams` and a resolved URL with every navigation metric.
Left alone, that would send real booking ids and payment references to a third party's dashboard.
`src/lib/observe.ts` filters them:

```
reference · id · bookingId · paymentId · tripId · operator
```

`reference` is the sharpest of these. It is the value inside every payment QR code, and
`/payment/[reference]` is a **public** page that needs no session — so a leaked reference is a
leaked payment page. The others identify a booking, a payment, a trip or a company.

Filtering a parameter also replaces the exported URL with `urlHidden: true`. That is the intended
trade, not a side effect: `routeName` is unaffected, so `/payment/[reference]` still arrives as the
grouping key, which is the part that is useful for performance. `PAY-2026-000001` is not.

**Keep the list in step** with the dynamic segments under `src/app/` and with any `params` passed to
`router.push`. A new `[something]` route is a new thing to decide about.

## Where TTI is marked, and why there

`markInteractive` answers "when could the user actually do something", so it belongs on the screen a
cold start lands on — not in the root layout, which hides the splash immediately, and not in
`src/app/index.tsx`, which only redirects.

| Screen | Marked when |
|---|---|
| `(user)/home.tsx` | bookings have loaded — the thing a passenger opens the app for |
| `(operator)/dashboard.tsx` | the day's figures resolve |
| `(driver)/duty.tsx` | the roster is on screen |
| `(admin)/overview.tsx` | the platform figures resolve |
| `(auth)/login.tsx` | immediately — nothing to fetch |
| `payment/[reference].tsx` | after the payment loads, past the early returns |

The last one is a genuine cold-start entry point: it is opened by scanning a QR code, with no
session and often with the app not installed at all.

`ObserveInteractiveMarker` fires once on mount, so each is rendered conditionally — mounting *is*
the signal. Changing its `params` afterwards does nothing and warns in development.

## What is dispatched, and when

- **Release builds only.** `dispatchInDebug` defaults to `false`, so `pnpm web`, a dev client and a
  Metro session record nothing. To test the integration end to end, set `dispatchInDebug: true`
  temporarily in `src/lib/observe.ts` — and take it out again.
- **Not in Expo Go.** Needs a development or production build.
- **Every device.** No `sampleRate` is set, which is right for a pilot. Add one if the volume in
  [production-costs.md](production-costs.md) §1 scenario C ever arrives.
- **`environment`** comes from `process.env.NODE_ENV`, so a release build reports `production`.

## Web is a no-op, on purpose

`expo-observe` ships a web shim whose `configure` and `dispatchEvents` do nothing. That is what makes
it safe in the root layout: the public `/payment/[reference]` page renders in that same tree in a
logged-out browser, and the rule in [AGENTS.md](../AGENTS.md) about keeping the root layout light is
about auth gates and native permission prompts — Observe asks the user for nothing.

Verified after wiring: `pnpm build:web` exports, `expo export --platform android` bundles, and the
payment page still renders logged-out with no console errors.

## Seeing metrics

```bash
eas observe:metrics-summary
```

```bash
eas observe:routes
```

Or the Observe tab in the EAS dashboard. Ingestion can be paused per account or per project from
there without shipping an app update.

## Before the first numbers arrive

**A new native module means the installed app is stale.** Autolinking happens at build time, so the
existing preview APK and any development client have no `ExpoObserve` in them. Rebuild:

```bash
pnpm build:apk
```

That build must pass `scripts/check-build-env.mjs` — see [deployment.md](deployment.md) → Android
builds for the environment variables it needs.

## Not done

- **`expo install --fix` was not run**, though the setup guide lists it as step one. It wants to move
  18 packages, and two of them are `jest 30.5.1 → 29.7.0` and `@types/jest 30 → 29.5.14` — a
  two-major downgrade of the test runner that 147 passing tests currently sit on. The expo-* patch
  bumps in that list are worth taking on their own, as a separate change that can be verified on its
  own. `expo-observe` needed none of them: it installs, typechecks, bundles for both platforms and
  runs.
- **Nothing has been observed on hardware.** No metric has been seen arriving in the dashboard,
  because that needs a release build on a device. The wiring is verified; the delivery is not.
- **`ObserveErrorBoundary` is available and unused** — `AppErrorBoundary` already covers render
  errors. `Observe.reportError` is now wired; see *Structured logging* below.

## Structured logging

Two halves, joined by one id.

**Edge Functions** (`supabase/functions/_shared/log.ts`). Every function starts with
`serve('<name>', handler)` from `_shared/http.ts` instead of `Deno.serve`. That gives each request an
id (a well-formed incoming `x-request-id` is kept, anything else replaced), returns it in the
`x-request-id` response header, and writes exactly one `request` line per call:

```json
{"ts":"…","level":"warn","fn":"manage-staff","requestId":"91dc…","event":"request","method":"POST","status":403,"code":"FORBIDDEN","durationMs":7}
```

Refusals are `warn`, 5xx are `error`, and an unhandled throw is logged with a trimmed stack and
answered with the standard INTERNAL_ERROR envelope instead of the runtime's bare 500. Anything else
worth recording is `log.info|warn|error('snake_case_event', { fields })` — there is no `console.*`
left in any function. The request context travels by `AsyncLocalStorage`, so `failFromRpc`, three
calls deep, logs against the right request; a module-level "current request" would mix up
concurrent requests in one isolate (tested).

Redaction is central, not per call site: any key naming a credential (`token`, `password`, `secret`,
`authorization`, `apikey`, `signature`, `cookie`) becomes `[redacted]`, an e-mail keeps only its
domain, a payment reference keeps only its last three digits, and long strings are cut at 500
characters. In the Supabase dashboard: **Edge Functions → Logs**, filter on the JSON, e.g. a
`requestId` from a user's report.

**The app** (`src/lib/report.ts`). TanStack Query's `QueryCache` and `MutationCache` `onError` send
every failure through `reportFailure`, which **drops the refusals the server meant** (FORBIDDEN,
SEAT_UNAVAILABLE, VALIDATION_ERROR…) and reports the rest to Observe: an `app_failure` event with
`where` (`query:sos`, `mutation:unknown`), `code`, and the function's `requestId` when there was one
— carried on `AppError.requestId` by `invokeFunction`. `Observe.reportError` adds the stack, except
for NETWORK_ERROR, which is counted but is not a bug. No booking id, reference, e-mail or message
text goes into the attributes. Release builds only, like every Observe event.

**Not done:** mutations have no `mutationKey`s, so a mutation failure is reported as
`mutation:unknown` until they are given names; and nothing aggregates the function logs beyond the
Supabase dashboard's own retention.
