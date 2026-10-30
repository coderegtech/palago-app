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

**All fifteen phases are built.** The full passenger journey
works end to end — trip search, a visual seat map, atomic seat reservation proven under concurrent
contention, a payment QR, a public test-payment page, server-side confirmation with receipts,
Realtime status, a signed boarding pass issued only after payment and usable once, a mock wallet
with a signed ledger, loyalty points, an in-app notification feed, and passenger-raised emergency
alerts. The operator console, the admin console and the driver app are in, along with the
admin → operator → crew hierarchy and schedule-conflict prevention enforced by database
constraints rather than by a form.

A security review (Phase 13) found and closed four write paths; Phase 14 added a coverage ratchet
and an honest map of which level tests what. What is **not** done is stated in each document rather
than implied: push delivery to a handset is unproven, MapLibre has never run on hardware, and the
Phase 15 GPS throttle and tree shaking are verified on web and in the database but not on a device. A feature-by-feature
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
| 12 | Notifications | **Done** — push to a handset still unproven |
| 13 | Security review | **Done** |
| 14 | Testing | **Done** |
| 15 | Production preparation | **Done** — handset verification of the GPS throttle outstanding |

## Screens

Every screen in the app, captured from it running against seeded data by `pnpm docs:screens`
— signed in and clicked through, never mocked up. The same shots with the reasoning behind
each one are in [docs/walkthrough.md](docs/walkthrough.md).

### Customer — booking a seat

|   |   |   |
| :--: | :--: | :--: |
| <img src="docs/screenshots/01-sign-in.png" width="230" alt="PalaGo sign-in screen" /><br>**Sign in** | <img src="docs/screenshots/02-home.png" width="230" alt="Passenger home screen with wallet, points and upcoming trips" /><br>**Home** | <img src="docs/screenshots/03-search.png" width="230" alt="Trip search: origin, destination, travel date and passenger count" /><br>**Search** |
| <img src="docs/screenshots/04-results.png" width="230" alt="Search results showing two Cherry Bus departures with fares and seats left" /><br>**Results** | <img src="docs/screenshots/05-trip-details.png" width="230" alt="Trip details: operator, times, duration, bus and seats available" /><br>**Trip details** | <img src="docs/screenshots/06-passenger-details.png" width="230" alt="Passenger details form: full name, passenger type, mobile and email" /><br>**Who is travelling** |

### Customer — paying

|   |   |   |
| :--: | :--: | :--: |
| <img src="docs/screenshots/06b-student-id-photo.png" width="230" alt="Passenger type set to Student, with the Student ID photo panel and its Upload ID picture button" /><br>**Discount ID** | <img src="docs/screenshots/07-payment.png" width="230" alt="Payment screen: base fare, discount, ₱10 convenience fee and amount to pay, with a ten-minute timer" /><br>**Payment** | <img src="docs/screenshots/07b-payment-qr.png" width="230" alt="Payment QR code with a Download QR code button, the time left to pay and the amount" /><br>**Payment QR** |

### Customer — travelling

|   |   |   |
| :--: | :--: | :--: |
| <img src="docs/screenshots/08-tickets.png" width="230" alt="My tickets: upcoming and past bookings" /><br>**My tickets** | <img src="docs/screenshots/09-boarding-pass.png" width="230" alt="Boarding pass with its QR code, a Download QR code button, and the operator, route, passenger and seat" /><br>**Boarding pass** | <img src="docs/screenshots/12-tracking.png" width="230" alt="Live tracking screen" /><br>**Live tracking** |

### Customer — wallet, rewards and account

|   |   |   |   |
| :--: | :--: | :--: | :--: |
| <img src="docs/screenshots/10-wallet.png" width="175" alt="Wallet balance and transaction ledger" /><br>**Wallet** | <img src="docs/screenshots/11-rewards.png" width="175" alt="Loyalty points balance and reward catalogue" /><br>**Rewards** | <img src="docs/screenshots/14-discount.png" width="175" alt="Fare discount screen for senior, student and PWD verification" /><br>**Fare discount** | <img src="docs/screenshots/15-notifications.png" width="175" alt="Notification feed" /><br>**Notifications** |

### Customer — emergencies

|   |   |
| :--: | :--: |
| <img src="docs/screenshots/13-sos.png" width="230" alt="Emergency assistance screen" /><br>**Emergency assistance** | <img src="docs/screenshots/16-sos-sent.png" width="230" alt="An emergency alert sent, listed under Your alerts with its location" /><br>**Alert sent** |

### Operator console

|   |   |
| :--: | :--: |
| <img src="docs/screenshots/20-operator-dashboard.png" width="420" alt="Operator dashboard: today's passengers, revenue, boarded count and trip statuses" /><br>**Dashboard** | <img src="docs/screenshots/20b-operator-sos-alert.png" width="420" alt="An open emergency alert on the operator dashboard: passenger name, trip, coach, route, location, and Call passenger, Open map, Acknowledge, Responding and Resolve" /><br>**Emergency alert** |
| <img src="docs/screenshots/21-operator-schedule.png" width="420" alt="Operator schedule listing departures with coach, crew and status" /><br>**Schedule** | <img src="docs/screenshots/22-schedule-form.png" width="420" alt="The schedule form: route, coach, trip number, date, times and fare" /><br>**New trip** |
| <img src="docs/screenshots/23-drivers.png" width="420" alt="Driver management showing account status and availability as separate columns" /><br>**Drivers and crew** | <img src="docs/screenshots/24-set-unavailable.png" width="420" alt="Set unavailable dialog explaining that access is kept" /><br>**Set unavailable** |
| <img src="docs/screenshots/25-operator-fleet.png" width="420" alt="Fleet list with coach numbers, plates, seat counts and road status" /><br>**Fleet** | <img src="docs/screenshots/26-travel-data.png" width="420" alt="Per-trip travel data with occupancy and on-time performance" /><br>**Travel data** |
| <img src="docs/screenshots/27-scanner.png" width="420" alt="QR boarding scanner" /><br>**Boarding scanner** | <img src="docs/screenshots/28-counter-sale.png" width="420" alt="Counter sale: origin, destination and travel date, then this operator's sellable trips" /><br>**Counter sale** |
| <img src="docs/screenshots/29-counter-passenger-form.png" width="420" alt="The passenger app's own details card, used at the counter" /><br>**Counter passenger** |   |

### Admin console

|   |   |
| :--: | :--: |
| <img src="docs/screenshots/30-admin-overview.png" width="420" alt="Platform overview with cross-operator totals" /><br>**Platform overview** | <img src="docs/screenshots/31-admin-operators.png" width="420" alt="Operator management with view, edit, add login and deactivate actions" /><br>**Operators** |
| <img src="docs/screenshots/32-add-operator-login.png" width="420" alt="Add a login dialog for an operator" /><br>**Add operator login** | <img src="docs/screenshots/33-temporary-password.png" width="420" alt="The temporary password, shown once with a warning" /><br>**Temporary password** |
| <img src="docs/screenshots/34-admin-schedules.png" width="420" alt="Every departure on the platform, filterable by operator" /><br>**Schedules** | <img src="docs/screenshots/35-admin-crew.png" width="420" alt="Every driver and conductor across all operators" /><br>**Crew** |
| <img src="docs/screenshots/36-admin-fleet.png" width="420" alt="Every coach across all operators" /><br>**Fleet** | <img src="docs/screenshots/37-admin-routes.png" width="420" alt="Route management" /><br>**Routes** |

|   |
| :--: |
| <img src="docs/screenshots/38-forced-password-change.png" width="230" alt="Forced password change on first sign-in" /><br>**Forced password change** |

### Driver and crew

|   |   |   |   |
| :--: | :--: | :--: | :--: |
| <img src="docs/screenshots/40-driver-duty.png" width="175" alt="Driver's trips ordered by status: departed first, then scheduled, then arrived" /><br>**Duty roster** | <img src="docs/screenshots/41-driver-trip.png" width="175" alt="One trip: status, position sharing, and the trip lifecycle buttons" /><br>**Trip lifecycle** | <img src="docs/screenshots/42-driver-scan.png" width="175" alt="Door scanner in the crew app" /><br>**Door scanner** | <img src="docs/screenshots/43-driver-availability.png" width="175" alt="Driver's own availability switch on the account screen" /><br>**Availability** |

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

802 checks across sixteen suites, every one signed in as a real seeded role through the ordinary
publishable key. Among them: eight simultaneous callers racing for one seat, confirming a payment
five times to prove one receipt, six simultaneous scans to prove a ticket boards once, two operators
pressing Save on the same coach at the same instant, one operator trying to read a rival's manifest,
revenue and fleet, a driver trying to rewrite the GPS trail they published, eight concurrent top-ups
to prove no centavo is lost, a redeem/undo loop that must not inflate lifetime points, a panicking
second press of the SOS button that must not raise a second emergency, and a passenger trying to add
a bus to someone else's fleet.

The last of those is a real hole this suite caught. So are the four in
[docs/security-review.md](docs/security-review.md), which `pnpm db:verify:security` now guards —
including an operator who could put a rival company's driver on their own bus.

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
- [management.md](docs/management.md) — the admin → operator → crew hierarchy, the two staff
  statuses, and how a bus is stopped from being in two places at once
- [observability.md](docs/observability.md) — EAS Observe: startup and navigation
  metrics, and the route parameters deliberately kept out of them
- [payment-flow.md](docs/payment-flow.md)
- [phases.md](docs/phases.md) — the phased build process, gates and invariants
- [production-costs.md](docs/production-costs.md) — assumptions and cost ranges for taking this to
  production: remaining development, hosting, VPS, payment gateway, maps, store deployment,
  Philippine compliance
- [qr-flow.md](docs/qr-flow.md)
- [realtime.md](docs/realtime.md)
- [security.md](docs/security.md)
- [testing.md](docs/testing.md) — the three levels, and which one actually proves what
- [security-review.md](docs/security-review.md) — the Phase 13 review: four write paths
  found and closed, what was assessed as adequate, and what was deliberately deferred
- [test-accounts.md](docs/test-accounts.md) — seeded sign-in credentials for local testing
- [testing.md](docs/testing.md)
- [walkthrough.md](docs/walkthrough.md) — the prototype screen by screen, as each of
  the four roles sees it, with screenshots taken from the running app
