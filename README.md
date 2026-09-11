# PalaGo

Online booking for Cherry Bus and RoRo Bus in Palawan — a passenger app, an operator app, and a
public test-payment page, built on Expo and Supabase.

> ## ⚠️ PalaGo currently uses MOCK PAYMENT ONLY
>
> **No real financial transactions are processed.** Stripe, GCash, Maya, card processing and bank
> payment APIs are *intentionally not connected*, and no code path in this repository can charge
> money. Every peso figure in the app, the receipts, and the operator dashboards is test data.
>
> The payment layer is provider-agnostic so a real provider can be added later without touching the
> booking system — see [docs/payment-flow.md](docs/payment-flow.md).

---

## Status

**Phases 1–10 of 15 are built and verified.** The full passenger journey works end to end —
trip search, a visual seat map, atomic seat reservation proven under concurrent contention, a
payment QR, a public test-payment page, server-side confirmation with receipts, Realtime status,
a signed boarding pass issued only after payment and usable once, a mock wallet with a signed
ledger, and loyalty points earned for completed trips. The operator console (dashboard, travel
data, manifest, fleet, crew, terminal scanner) and the driver app (duty board, trip lifecycle,
GPS publishing, door scanner) are in, as are passenger-raised emergency alerts with the operator
response workflow behind them. The notifications feed renders a clearly-labelled placeholder
naming the phase that will implement it; nothing is faked as working. A feature-by-feature
reference is in [docs/features.md](docs/features.md).

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation: Expo, NativeWind, UI primitives, theme, Supabase client, env, navigation | **Done** |
| 2 | Authentication, profiles, roles, route guards | **Done** |
| 3 | Reference schema, trips, seat inventory, crew, RLS, seed data | **Done** |
| 4 | Trip search, seat reservation, booking | **Done** |
| 5 | Mock payment, payment QR, web payment page, receipts | **Done** |
| 6 | Boarding QR generation and server-side validation | **Done** |
| 7 | Operator app — dashboard, travel data, manifest, crew, fleet | **Done** |
| 8 | Realtime trip tracking, driver app, trip lifecycle, on-time rate | **Done** |
| 9 | Mock wallet, test top-ups, paying a booking from balance | **Done** |
| 10 | Loyalty — points, rewards catalogue, redemption | **Done** |
| 11 | SOS — emergency alerts, location capture, operator response workflow | **Done** |
| 12 | Notifications | Not started |
| 13 | Security review | Not started |
| 14 | Testing | Not started |
| 15 | Production preparation | Not started |

## Tech stack

| Layer | Choice |
|---|---|
| App | Expo SDK 57, React Native 0.86, React 19.2, TypeScript 6 (strict) |
| Navigation | Expo Router (typed routes) |
| Styling | NativeWind 4 + Tailwind CSS 3.4, tokens in `tailwind.config.js` / `src/constants/theme.ts` |
| Server state | TanStack Query |
| Client state | Zustand |
| Forms | React Hook Form + Zod |
| Icons | lucide-react-native; brand mark drawn with react-native-svg |
| Maps | **MapLibre** (`@maplibre/maplibre-react-native`) — native only, see below |
| Backend | Supabase — Postgres, Auth, Realtime, Storage, Edge Functions, RLS |
| Payment web page | An Expo Router route (`/payment/[reference]`) served by the web build |
| Tests | Jest (`jest-expo`) + React Native Testing Library |

The payment page is a route in this same app rather than a separate web project. Two rules follow
from that and must be preserved: the root layout stays free of auth gates and native permissions,
and `app.json` keeps `web.output: "single"` so an arbitrary payment reference resolves client-side.

**Maps need a development build.** MapLibre is a native module — it does not run in Expo Go, and it
has no react-native-web build, so `src/components/ui/map.tsx` is native-only with `map.web.tsx` as a
web placeholder. Without that split the web bundle breaks, taking the public payment page with it.
Tiles come from `EXPO_PUBLIC_MAP_STYLE_URL` (OpenFreeMap by default, no API key). See
[docs/realtime.md](docs/realtime.md).

**Brand assets are generated.** `assets/brand/palago-icon.svg` is the source; app icons come from
`node scripts/generate-icons.mjs`. Never hand-edit the PNGs in `assets/images/`. See
[docs/brand.md](docs/brand.md).

## Getting started

Requires **Node 22.13+**, **pnpm**, and **Docker Desktop** (for the local Supabase stack).

```bash
pnpm install
```

```bash
cp .env.example .env
```

### Supabase (local)

```bash
pnpm db:start
```

The first run pulls roughly 6 GB of Docker images and takes a while. Then:

```bash
pnpm exec supabase status
```

Copy `API_URL` and `PUBLISHABLE_KEY` (the `sb_publishable_…` value — not the legacy `ANON_KEY`)
into `.env`. Never copy `SECRET_KEY` or `SERVICE_ROLE_KEY` anywhere near the app.

Studio runs at <http://127.0.0.1:54323>. `pnpm db:reset` re-applies migrations and seed data;
`pnpm db:stop` shuts the stack down.

To point at a hosted project instead, replace the two Supabase values in `.env` — nothing else
changes.

### Run the app

```bash
pnpm start
```

```bash
pnpm web
```

```bash
pnpm android
```

Testing on a physical device against the local stack? `127.0.0.1` resolves to the phone itself —
set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_WEB_PAYMENT_BASE_URL` to your machine's LAN address.

### Checks

```bash
pnpm check
```

Runs `typecheck`, `lint`, and `test` in sequence. Each is also available on its own.

RLS lives in Postgres and no unit test can cover it, so policies have their own suite — run it after
any migration that touches one:

```bash
pnpm db:verify:all
```

446 checks across eleven suites — 31 RLS, 38 booking, 49 payment, 38 boarding, 34 operator, 52
tracking, 51 wallet, 49 loyalty, 40 SOS, 33 discount and 31 admin — including eight simultaneous
callers racing for one seat, confirming a payment five times to prove one receipt, six simultaneous
scans to prove a ticket boards once, one operator trying to read a rival's manifest, revenue and
fleet, a driver trying to rewrite the GPS trail they published, eight concurrent top-ups to prove
no centavo is lost, a redeem/undo loop that must not inflate lifetime points, a panicking second
press of the SOS button that must not raise a second emergency, and a passenger trying to add a bus
to someone else's fleet — which is a real hole this suite caught.

## Project structure

```
src/
  app/            Expo Router routes — (auth), (user), (operator), booking, bookings, payment
  components/
    ui/           Design-system primitives (Button, Input, Card, Screen, states, …)
    common/       Shared app components (logo, placeholders)
  constants/      Design tokens, domain enums, error codes, business rules
  hooks/          TanStack Query wrappers over services
  lib/            Supabase client, validated env, query client, error mapping
  providers/      Root providers
  schemas/        Zod validation schemas
  services/       Business logic per domain — added by the phase that owns each one
  stores/         Zustand stores (client state only)
  types/          Domain models, API envelope, generated database types
  utils/          Money, class-name merging
supabase/
  migrations/     SQL migrations
  functions/      Edge Functions (Phase 5+)
docs/             Architecture, auth, database, deployment, payment, QR, realtime, security, test accounts, testing
```

After changing a migration, regenerate the database types — never hand-edit them:

```bash
pnpm db:types
```

## Security posture

The client holds only the publishable Supabase key, so everything it can reach is bounded by Row
Level Security. Prices, payment status, booking status, loyalty points and boarding state are
decided by the server and never accepted from the client. See [docs/security.md](docs/security.md).

## Documentation

- [features.md](docs/features.md) — what PalaGo does today, surface by surface
- [architecture.md](docs/architecture.md)
- [auth.md](docs/auth.md)
- [brand.md](docs/brand.md)
- [database.md](docs/database.md)
- [deployment.md](docs/deployment.md) — the web build on Vercel, and what it does *not* deploy
- [payment-flow.md](docs/payment-flow.md)
- [phases.md](docs/phases.md) — the phased build process, gates and invariants
- [qr-flow.md](docs/qr-flow.md)
- [realtime.md](docs/realtime.md)
- [security.md](docs/security.md)
- [test-accounts.md](docs/test-accounts.md) — seeded sign-in credentials for local testing
- [testing.md](docs/testing.md)
