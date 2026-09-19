# Features

What PalaGo does today, surface by surface. This is a functional reference — the
"why" behind each design sits in the topic docs linked throughout, and the build
order and gates are in [phases.md](phases.md).

Phases 1–11 are built and verified. Phases 12–15 (notifications feed, security
review, test broadening, production prep) are not — the one screen that belongs
to them renders a labelled `PlaceholderScreen` naming the phase.

## What this is not

**Mock payment only.** No Stripe, GCash, Maya, card or bank integration is
connected, and no code path in the repo can move money. `src/lib/env.ts` rejects
any provider but `mock`; `payments.provider` carries a `= 'MOCK'` check
constraint. Every peso figure — balances, receipts, revenue, discounts — is test
data. The provider-agnostic seam that lets a real provider drop in later is in
[payment-flow.md](payment-flow.md).

The in-app "TEST PAYMENT / TEST DATA" banners were removed on request. The build
still charges nothing, but nothing on screen says so any more.

## Roles

Set administratively with the service role — never self-selected at sign-up, and
enforced by Postgres column grants, not only by policy.

| Role | Lands on | Can do |
|---|---|---|
| `USER` | `(user)` passenger app | search, book, pay, board, wallet, rewards, track |
| `OPERATOR` | `(operator)` console | own trips, manifests, fleet, crew, terminal scanner |
| `DRIVER` / `ASSISTANT` | `(driver)` crew app | own duty board, trip lifecycle, GPS, door scanner |
| `ADMIN` | `(user)` passenger app | admin reach through RLS; no dedicated dashboard in this build |

`AuthGate` is navigation only — it keeps a role out of the wrong tab group. Data
access is enforced independently by Row Level Security. See
[auth.md](auth.md) and [security.md](security.md).

---

## Passenger app — `(user)`

### Account

Sign up, sign in, sign out, password reset, and profile editing (name, phone,
emergency contact). Profiles are created by a database trigger on
`auth.users` insert, so a registration cannot half-succeed. Password recovery
opens `/reset-password` at the router root — outside `(auth)`, because the
recovery link creates a real session and an `(auth)` layout would redirect the
user away from the form. Local mail is caught by Mailpit on `:54324`.

### Home

Greeting, the next upcoming trip, wallet balance and points total (both real,
read from the server), and quick links into search, tickets, tracking,
notifications and SOS.

### Trip search — `booking/search`, `booking/trip-details`

Origin/destination terminal pickers, date, passenger count. Results come from the
`trip_search` view (declared `security_invoker` so it cannot become a way around
RLS) and carry operator, both terminals, the bus, fare and a **live bookable-seat
count** in one query rather than an N+1. Trip details shows the route, schedule,
duration, bus type and per-passenger fare.

### Seat selection — `booking/seats`, `booking/passengers`

A visual 2+2 seat map rendered from `trip_seats`: available, held, booked and
blocked are each distinct — never conveyed by colour alone. Row 1 is priority
seating. Per-passenger details (name, phone, type: adult / child / senior /
student / PWD).

Reserving calls **`reserve_seats(p_trip_id, p_passengers)`**, one transactional
RPC that locks the rows in a deterministic order, reclaims expired holds, checks
availability, creates the `bookings` and `booking_passengers` rows, writes
10-minute holds, and returns atomically. The owner comes from `auth.uid()`; price
is computed from the trip's own fare. A booking lands at `PAYMENT_PENDING` with
seats `HELD`. See [database.md](database.md).

### Payment — `booking/payment`, `booking/payment-qr`

Two ways to pay, both ending in the identical state (a `PAID` payments row, a
receipt, `BOOKED` seats, a `CONFIRMED` booking, an audit row and a notification):

- **Payment QR.** `create-test-payment` opens a MOCK payment and returns a
  reference plus a 32-byte bearer token. The app renders a QR that encodes the
  public payment URL. Scanning it on any device opens the web payment page
  (below). The app listens over Supabase Realtime and updates the moment the
  payment is confirmed — including a confirmation performed in another browser.
- **Wallet.** `pay_booking_with_wallet(p_booking_id)` debits the balance and
  writes the ledger under one lock, then produces the same payments row and
  receipt (`receipts.payment_method = 'PalaGo Wallet'`). The button is disabled
  when the balance cannot cover the fare and says how much is short. The amount
  is re-derived from the booking — never sent by the client.

A reward can be applied before paying (see Rewards) — `confirm_test_payment`
re-derives the amount and refuses a payment whose figure no longer matches, so a
discount cannot be bolted on afterward.

### Boarding pass — `bookings/[id]`

Issued by **`get-boarding-pass`** only once the booking is paid and confirmed —
a boarding pass that could exist before payment would be a security hole, not a
missing feature. The QR carries a booking id, reference and an **HMAC-SHA256
signed token** (the secret never reaches the client) and nothing else — no names,
no seats, since anything in a QR is readable by whoever photographs the screen.
Valid for 48 hours. See [qr-flow.md](qr-flow.md).

### Tickets — `(user)/bookings`, `bookings/[id]`

List of all bookings with status (awaiting payment, confirmed, boarded, on trip,
completed, cancelled, refunded — each a word plus a tone). Detail screen shows
the trip, passengers and seats, the fare breakdown, the boarding pass when
eligible, and **cancellation** for a booking still in `PENDING` / `PAYMENT_PENDING`
via `cancel_booking` (idempotent; releases the held seats, returns any staked
reward points).

### Wallet — `(user)/wallet`

Real balance, an append-only **signed ledger** (`sum(amount) = balance` is the
invariant), and bounded **test top-ups** through `top_up_wallet(p_amount,
p_idempotency_key)` — idempotent on the key so a double tap on a flaky connection
mints balance once. Presets plus a custom amount; per-transaction and total caps
mirrored from `src/constants/config.ts`. Every entry reads in plain language
(top-up, booking payment, refund, reward, adjustment). No client write path to
the balance or the ledger. See Phase 9 in [phases.md](phases.md).

### Rewards — `(user)/rewards`

Points balance, lifetime points (only ever rises; credits only), the ledger, and
the rewards catalogue (fixed-amount and capped-percentage discounts — no "perk"
rewards, because a perk nothing enforces would be a feature that exists only as a
table row).

- **Earned on payment: one point per ₱100.** `floor(paid / ₱100)`, whole points
  only (₱250 → 2, ₱999 → 9), from what was actually PAID after discounts and
  rewards. Credited by a trigger on `payments` the moment any payment path —
  mock provider, wallet, counter — marks one PAID, so a future provider earns
  points without being taught to. Exactly-once, enforced by a unique index; a
  re-confirmed payment or `end_trip` afterwards credits nothing more.
- **Refunds take the points back** (`REVERSED`, also exactly-once). Points
  already spent on a reward stay spent — the balance never goes negative — and
  the refunded booking's credit leaves `lifetime_points` too. Walk-ins have no
  account and earn nothing.
- **Redeeming** (`redeem_reward`) applies a server-computed discount to an unpaid
  booking and stakes the points. Cancelling the redemption, cancelling the
  booking, or refunding it all return the staked points; lifetime points do not
  move. One reward per booking.

### Live tracking — `(user)/tracking`

For a booking on a trip that is boarding or under way, a map with the bus's
latest position and recent trail, speed, heading, and the scheduled arrival.
Authorisation is `can_track_trip` server-side — a paid booking grants it, an
unpaid hold does not, a refund takes it away. Updates arrive over Realtime.

Every degraded state is distinct and named: permission denied, location services
off, no fix yet, patchy connection, repeated failures, stale last-known position
with its age. **No estimated arrival** — a straight-line guess is wrong on the
Puerto Princesa–El Nido road, and a passenger who misses a connection because
PalaGo guessed is worse off than one told nothing.

> **The map has never rendered on a device.** MapLibre is native-only (no Expo
> Go, no web) and needs a development build. Everything behind it — the data, the
> authorisation, the Realtime updates, the honest states — is verified via the
> server and the web placeholder. See [realtime.md](realtime.md).

### Emergency assistance — `(user)/sos`

A passenger raises an alert; it captures where they are and reaches the operator
running their trip. The trip is resolved **server-side** from the caller's own
booking — a client-supplied trip id would let anyone attach an alert to a trip
they are not on.

- **One open alert per passenger**, enforced by a partial unique index. Pressing
  again while one is open returns that alert (`alreadyOpen: true`) rather than
  splitting one emergency into two half-attended ones.
- The passenger can **cancel their own false alarm** — but not once a responder
  is already on the way. That call belongs to the people responding.
- Each stage is named as it happens (sent → seen by operator → responder on the
  way → resolved). The screen does not claim help is coming before a responder
  has said so, and says plainly that PalaGo does not call emergency services for
  you.
- `sos_incidents` has **no client write path at all** — no INSERT, UPDATE or
  DELETE for anyone, including the passenger who raised it and the operator
  working it. An alert is a record.

---

## Admin console — `(admin)`

Signing in as an ADMIN now lands on `/(admin)/overview` rather than the
passenger home. Five destinations, named so they cannot collide with existing
routes (route groups do not appear in the URL, so `overview` not `dashboard`,
`fleet` not `buses`).

**Desktop-first, still responsive.** A persistent sidebar from `md` up — full
labels at `lg`, an icon rail between — and a bottom bar below it. The shell is a
`Slot` rather than `Tabs` because React Navigation's bottom-tabs can only place
its bar beneath the content, and a dashboard's chrome belongs beside it; the
admin screens are flat lists with no nested stacks, so no per-tab navigation
state is given up. Sign-out lives in the sidebar footer on desktop and on the
Overview screen below it, since the bottom bar has no room and the console can
have no Account tab (`account.tsx` would collide with the operator console's).

**Records are tables, edits are modals.** `DataTable` renders a real table on a
wide screen and a list of labelled cards on a phone, both driven by one column
definition so a header can never drift from the cells under it. Columns marked
`primary` become the card's title in stacked mode. A table narrower than its
`minWidth` scrolls sideways rather than crushing its columns. Every insert is a
form modal over the table, validated against the same bounds the schema
enforces — coordinate ranges, distinct origin and destination, capacity 1–100 —
so the form refuses what the database would refuse anyway.

Every table has search, filter chips, a sort control and pagination
(`TableToolbar` over `DataTable`, with the filtering, sorting and paging in a
pure, unit-tested `applyTableControls`).

| Screen | What it does |
|---|---|
| **Overview** | Platform-wide analytics from `admin_dashboard` — today's trips, passengers, boarded, revenue and on-time rate across every operator, lifetime bookings and revenue, reference-data counts, and the same figures broken out per operator |
| **Operators** | Bus companies: create, view, edit, activate/deactivate — **and the only place an operator login can be created**, reset, or disabled. Each company's accounts and their recent administrative activity are on the detail sheet |
| **Terminals** | Stations: create, edit, open/close, with latitude/longitude validated against the same bounds the schema enforces |
| **Routes** | Corridors: create, edit the journey time, retire/reinstate. Where a route *goes* is not editable — re-pointing it would silently change every trip and ticket sold on it |
| **Fleet** | Every coach across all operators: create with its seat layout, edit, move between companies (only while it is on nobody's schedule), take off the road / put back |
| **Schedules** | Every departure on the platform, from `trip_search` — create, edit, roster crew, cancel, and tune the turnaround buffer. Shows the ones the operator views hide: a departure whose coach has been withdrawn or whose operator is suspended |
| **Crew** | Every driver and conductor across all operators, with both statuses, and activate/deactivate on the account. Rosters themselves belong to the operator who employs them |

Creating an account for somebody else needs the service-role key, so it is an
Edge Function — `manage-staff` — and every rule it applies is asked of SQL **as
the signed-in caller**. See [management.md](management.md).

`admin_dashboard` exists because the operator views are scoped through
`current_operator_id()` and an admin has no operator — `operator_dashboard`
correctly returns `NO_OPERATOR` for them. `create_bus` exists because a coach
and its `bus_seats` must arrive together: a bus with no seat rows looks sellable
but cannot be booked, and the 2+2 layout is generated from `capacity`
server-side so the two cannot disagree.

**Nothing here deletes anything.** Operators, terminals, routes, buses and trips
are referenced by bookings, payments, tickets and boarding scans, so the client
INSERT/UPDATE/DELETE on all five was withdrawn and every write goes through an
audited function. Every "Delete" in the console is deactivation, and the
confirmation dialog says so.

The admin's revenue figure for an operator is asserted equal to what that
operator sees on its own dashboard, so the two consoles cannot drift apart about
money.

---

## Public payment page — `/payment/[reference]`

A route in this same app, served by the web build, opened by scanning the
payment QR in a **logged-out browser**. It has no PalaGo session; the QR token
is the entire credential.

- `get-payment` returns a deliberately narrow summary (trip, amount, status) —
  never the token, user ids, or anything about other bookings. A wrong token
  returns `NOT_FOUND`, indistinguishable from a missing payment, so a reference
  cannot be probed.
- Confirming calls `confirm-test-payment` → `confirm_test_payment`, which does
  everything in one transaction and is **idempotent**: confirming five times
  leaves one payment, one receipt, one confirmation. A repeat returns the
  existing receipt with `alreadyConfirmed: true`.

Two invariants exist for this page: the root layout stays free of auth gates and
native permission providers (it renders in that same tree), and `app.json` keeps
`web.output: "single"` so an arbitrary reference resolves client-side.

---

## Operator console — `(operator)`

Every screen reads an `operator_*` view whose scoping lives **inside the view**
(`where … = current_operator_id() or is_admin()`), never in the caller —
`trips` and `buses` are world-readable for search, so a caller-side filter leaked
a rival's data twice during the build.

| Screen | What it shows |
|---|---|
| **Dashboard** | Today's passengers, revenue, seats sold, boarded count, trip status counts — all aggregated server-side by `operator_dashboard` (SECURITY DEFINER, explicit role check; returns `scope: 'NO_OPERATOR'` for an admin rather than inventing figures) |
| **Travel data** | Per-trip overview from `operator_trip_overview` — occupancy, revenue, on-time status against scheduled vs. actual departure |
| **Manifest** | Passenger list per trip from `operator_manifest` — names, seats, booking status, payment status, boarded state |
| **Schedule** (`trips`) | Every departure this company runs: create, edit, roster a driver and conductor, withdraw from sale, cancel. A clash is refused by the database and names the departure in the way |
| **Fleet** (`buses`) | Buses from `operator_fleet` (a dedicated view — reading `buses` directly showed a Cherry account RoRo's coaches): create with its seat layout, edit, take off the road / put back |
| **Drivers** | The driver roster, with **two separate statuses** — account (can sign in) and availability (can be rostered) — plus create with or without a login, edit, reset password, activate/deactivate the account, and set available/unavailable with a reason |
| **Crew** | The same for conductors and assistants. An operator cannot touch another operator's roster, and cannot create another operator |
| **Scanner** | Validate and board tickets at the terminal (see Boarding below) |
| **SOS panel** | Open emergency alerts raised on this operator's trips, with acknowledge / responding / resolve. Live over Realtime *and* polled — a console that missed an alert because a websocket dropped is worse than one that refetches too often. Empty state says so honestly, which it could not before Phase 11 |
| **Account** | Operator profile, sign out (named `account.tsx`, not `profile.tsx`, to avoid a route collision with the passenger screen) |

Verified by `pnpm db:verify:operator` (36 checks): an operator sees only its own
data; a passenger and an anonymous caller see nothing in any operator view; a
rival cannot read a manifest, add crew elsewhere, or change another operator's
driver's availability; the dashboard numbers track a real booking driven through
payment and boarding by exactly the right amounts.

The hierarchy, the two statuses and the scheduling rules are covered by
`pnpm db:verify:staff` (80 checks) and `pnpm db:verify:schedules` (67), and
described in [management.md](management.md).

---

## Driver / crew app — `(driver)`

Separate from the operator console on purpose — crew must not see revenue and
fleet. Deliberately three tabs.

| Screen | What it does |
|---|---|
| **My trips** (`duty`) | The crew member's own assignments from `driver_assignments`, scoped inside the view to `current_driver_id()` / `current_assistant_id()` |
| **Trip** (`trip`) | One assignment: passenger and boarded counts, and the **trip lifecycle** — `set_trip_boarding` → `start_trip` → `end_trip`. Each is idempotent by precondition; a retry after a dropped connection does not move a recorded timestamp. `start_trip` activates the crew assignment (opening the GPS write path) and moves boarded passengers to `ON_TRIP`; `end_trip` stamps arrival, completes the assignment, completes boarded passengers' bookings, and awards loyalty points |
| GPS publishing | While a trip is live, the assigned driver's device publishes fixes straight into `bus_locations` — a direct table write guarded by RLS (the one deliberate exception to "privileged work goes through an Edge Function": a GPS ping has no secret and no cross-row invariant). `driver_id` is defaulted from `current_driver_id()`, never sent. **Append-only** — no update or delete for anyone, including the driver who wrote it. Foreground location only |
| **Scan** (`scan`) | Board passengers at the door — same `BoardingScanner` component and same server checks as the operator's terminal scanner |
| **Account** (`crew-account`) | Crew profile, the foreground-location note, sign out |

Verified by `pnpm db:verify:tracking` (52 checks): only the assigned driver
publishes, and only while the trip is live; an assistant, the owning operator, a
passenger and an anonymous caller are all refused; nobody can edit or delete a
published position.

---

## Boarding — used by both scanners

1. **`validate-qr`** verifies the HMAC signature (a forged token never reaches
   the database), then `validate_booking_qr` checks booking state. Both are
   required — a cancelled booking has a perfectly valid signature. Returns a
   **result** (`VALID` / `UNPAID_BOOKING` / `WRONG_TRIP` / `ALREADY_BOARDED` /
   `INVALID_QR`) rather than an error, so the operator at the door sees which
   applies. Shows the passenger detail needed at the door and nothing more.
2. **`confirm-boarding`** re-verifies the signature (not a `bookingId` from the
   client) and calls `confirm_boarding`: `CONFIRMED`/`CHECKED_IN` → `BOARDED`,
   once. The status transition under a row lock **is** the duplicate-scan
   protection — one of six simultaneous scans boards the passenger, the rest get
   `ALREADY_BOARDED`.

Every scan, including failures, is written to `qr_scans`. Manual entry (cracked
screen, dead phone) is a real operational path through the identical server
checks. Camera scanning needs a development build and has not run on hardware;
the path behind it is verified through manual entry. See [qr-flow.md](qr-flow.md).

---

## Server capabilities

### RPCs (`SECURITY DEFINER`, called from services)

| Function | Purpose |
|---|---|
| `reserve_seats` | Lock seats, create booking + passengers, write holds — atomic |
| `cancel_booking` | Release holds, return staked points; idempotent |
| `expire_seat_holds` | Reclaim lapsed holds (service role) |
| `create_test_payment` | Open a MOCK payment for an owned booking |
| `get_public_payment` | Narrow summary for the session-less payment page |
| `confirm_test_payment` | Mark PAID, issue receipt, confirm booking, book seats, ledger/audit/notify — idempotent |
| `refund_test_payment` | Reverse a payment; credit a wallet-paid booking back to its wallet; return staked points; idempotent |
| `expire_stale_payments` | Cancel stale PENDING payments |
| `set_payment_url` | Store the provider's payment URL (privileged setter) |
| `validate_booking_qr` | Booking-state check behind `validate-qr` |
| `confirm_boarding` | `→ BOARDED` once, under a row lock |
| `top_up_wallet` | Bounded, idempotent test credit |
| `pay_booking_with_wallet` | Pay a booking from balance to the same end state as QR |
| `wallet_post` | Move balance + write ledger together (private — not granted) |
| `award_loyalty_for_booking` / `reverse_loyalty_for_booking` | Points on payment, taken back on refund — each exactly once, run by the `payments_sync_loyalty` trigger |
| `redeem_reward` / `release_booking_redemption` / `cancel_reward_redemption` | Apply / undo a reward on an unpaid booking |
| `loyalty_post` | Move points balance + write ledger together (private) |
| `set_trip_boarding` / `start_trip` / `end_trip` | Trip lifecycle; idempotent by precondition |
| `operator_dashboard` | Server-side daily totals for the caller's operator |
| helpers | `is_admin`, `current_operator_id`, `current_driver_id`, `current_assistant_id`, `can_track_trip`, `can_publish_location`, `can_scan_trip`, `can_manage_trip_status`, `trip_available_seats` |

### Edge Functions (`supabase/functions/`)

| Function | Auth | Notes |
|---|---|---|
| `create-test-payment` | JWT | Forwards the caller's JWT; amount computed in the DB |
| `get-payment` | Public | Token from the QR is the credential |
| `confirm-test-payment` | Public | Idempotent; no provider contacted |
| `get-boarding-pass` | JWT | Signs the boarding token server-side; refuses unless paid + confirmed |
| `validate-qr` | JWT | HMAC verify, then booking-state check |
| `confirm-boarding` | JWT | Re-verifies the signature, not a client `bookingId` |

### Views

`trip_search`, `operator_trip_overview`, `operator_manifest`, `operator_fleet`,
`trip_live_position`, `driver_assignments` — all `security_invoker`, all scoped
inside the view where the base table is world-readable.

---

## Realtime

- **Payments** — the app subscribes to its pending payment and reflects a
  confirmation performed anywhere, including the public web page.
- **Trips** — `replica identity full`, so a status change carries the whole row.
- **`bus_locations`** — passengers on a paid booking receive the driver's fixes;
  Realtime respects RLS, so the filter is not client-side.

Details and the MapLibre web/native split are in [realtime.md](realtime.md).

---

## Data-integrity guarantees (proven, not assumed)

`pnpm db:verify:all` — 446 checks across eleven suites (31 RLS, 38 booking, 49
payment, 38 boarding, 34 operator, 52 tracking, 51 wallet, 49 loyalty, 40 SOS,
33 discount, 31 admin) — signs in as each real role through the publishable key
and asserts, among much else:

- eight simultaneous callers race for one seat → exactly one wins; overlapping
  seat sets in opposite orders do not deadlock; expired holds return to available
- confirming a payment five times → one payment, one receipt, one confirmation
- six simultaneous boarding scans → the passenger boards once
- eight concurrent wallet top-ups → no centavo lost; balance always equals the
  ledger sum
- a wallet payment reaches the identical end state as a QR payment
- points are credited once per paid booking — six simultaneous confirmations
  credit once — and reversed once on refund; neither a redeem/undo loop nor a
  pay/refund loop inflates lifetime points
- one operator cannot read a rival's manifest, revenue or fleet, or touch its crew
- a driver cannot rewrite the GPS trail they published
- `start_trip` / `end_trip` retries do not move a recorded timestamp
- a second SOS press returns the open alert instead of raising a second
  emergency; no client can INSERT, UPDATE or DELETE an incident; a rival
  operator can neither see nor act on one

---

## Not built yet

| Phase | Feature | Current state |
|---|---|---|
| 12 | **Notifications feed** — in-app list + push delivery (rows are already written by payment, boarding, loyalty and SOS; the feed and push are not) | `PlaceholderScreen` at `(user)/notifications` |
| 13 | Security review — work the attack list in [security.md](security.md) | — |
| 14 | Testing — broaden to the full scenario list in [testing.md](testing.md) | — |
| 15 | Production preparation — performance, monitoring, logging, env separation, deployment | — |

## Verified vs. unverified

Everything above is verified against the database and, for the passenger and
public-payment flows, in a browser. **Nothing has run on physical hardware.**
Specifically unexercised on a device: MapLibre map rendering, `expo-location`
publishing, and `expo-camera` QR scanning — each needs `npx expo run:android`.
The full logic behind all three is verified through the server and through manual
entry / web placeholders that share the same code. This is stated the same way
in [phases.md](phases.md) rather than glossed.
