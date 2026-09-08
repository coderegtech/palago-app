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

**Phase 3 of 15 — database foundation.** Working auth and roles, plus the full reference schema:
operators, terminals, routes, buses, seat layouts, trips with automatic seat inventory, and crew —
all under Row Level Security, with seed data and an RLS verification suite. Screens beyond that
render a clearly-labelled placeholder naming the phase that will implement them; nothing is faked
as working.

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation: Expo, NativeWind, UI primitives, theme, Supabase client, env, navigation | **Done** |
| 2 | Authentication, profiles, roles, route guards | **Done** |
| 3 | Reference schema, trips, seat inventory, crew, RLS, seed data | **Done** |
| 4 | Trip search, seat reservation, booking | Not started |
| 5 | Mock payment, payment QR, web payment page, receipts | Not started |
| 6 | Boarding QR generation and server-side validation | Not started |
| 7 | Operator app | Not started |
| 8 | Realtime trip tracking | Not started |
| 9 | Wallet | Not started |
| 10 | Loyalty | Not started |
| 11 | SOS | Not started |
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
pnpm db:verify
```

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
docs/             Architecture, auth, database, payment, QR, realtime, security, testing
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

- [architecture.md](docs/architecture.md)
- [auth.md](docs/auth.md)
- [brand.md](docs/brand.md)
- [database.md](docs/database.md)
- [payment-flow.md](docs/payment-flow.md)
- [qr-flow.md](docs/qr-flow.md)
- [realtime.md](docs/realtime.md)
- [security.md](docs/security.md)
- [testing.md](docs/testing.md)
