# Phased build process

PalaGo is built in 15 sequential phases. This document is the process itself: the rule, the gate
every phase must clear, what each phase covers, the setup it needs, and the invariants that no phase
is allowed to break.

## The rule

**Do not start phase N+1 until phase N passes its gate.**

Not a stylistic preference. Each phase is the foundation the next one stands on — seat reservation
is meaningless without a schema, payment confirmation is meaningless without a booking, and a
boarding QR issued before payment is a security hole. Building ahead of the foundation produces work
that has to be redone once the thing underneath it turns out to be shaped differently.

A phase is finished when it is **verified**, not when the code is written.

## The gate

Every phase ends with the same checklist. All of it, every time.

```bash
pnpm check
```

Runs `typecheck` → `lint` → `test` in sequence. Zero errors, zero warnings, all tests passing.

```bash
pnpm db:verify:all
```

Required whenever the phase touched a migration or a policy. RLS lives in Postgres and no unit test
can reach it — this signs in as each seeded role through the ordinary publishable key and asserts
what each may and may not do.

Then, before declaring the phase done:

1. **Files created and modified**, listed.
2. **Database changes** explained — tables, policies, functions, triggers.
3. **Backend changes** explained — Edge Functions, RPCs.
4. **Browser or device verification** of the actual feature, not just a passing test. Confirm
   behaviour by reading computed state, not by looking at a screenshot and assuming.
5. **How to run the feature**, concretely.
6. **What is still incomplete**, stated plainly.

### Rules that make the gate mean something

- **Never report a feature as done because a screen renders.** Unfinished routes use
  `PlaceholderScreen`, which names the phase that will implement them.
- **Never fake a successful backend operation.** No hardcoded success responses, no confirming a
  payment in React state.
- **A test that passes for the wrong reason is worse than no test.** This is not hypothetical: the
  Phase 3 RLS suite initially "failed" two operator-isolation checks, and the bug was in the test —
  it had picked a row belonging to the wrong operator, so the update was blocked by a unique
  constraint rather than by policy. Check what actually caused a pass or a fail.
- **Report honestly.** If something is unverified, say so and say why. The MapLibre `Map` component
  typechecks against the real v11 API but has never run on hardware; that is written down rather
  than glossed.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation — Expo, NativeWind, UI primitives, theme, Supabase client, env, navigation | **Done** |
| 2 | Authentication, profiles, roles, route guards | **Done** |
| 3 | Reference schema, trips, seat inventory, crew, RLS, seed data | **Done** |
| 4 | Trip search, seat reservation, booking | **Done** |
| 5 | Mock payment, payment QR, web payment page, receipts | **Done** |
| 6 | Boarding QR generation and server-side validation | **Done** |
| 7 | Operator app — dashboard, travel data, manifest, crew, fleet | **Done** |
| 8 | Realtime trip tracking, driver app, trip lifecycle, on-time rate | **Done** |
| 9 | Mock wallet — balance, test top-ups, ledger, paying a booking | **Done** |
| 10 | Loyalty — points earned for completed trips, rewards catalogue, redemption | **Done** |
| 11 | SOS — emergency alerts, operator response workflow | **Done** |
| 12 | Notifications | **Done** — in-app feed and realtime verified; push delivery to a handset unproven (needs a device) |
| 13 | Security review | **Done** — four write paths found and closed, see [security-review.md](security-review.md) |
| 14 | Testing | **Done** — 180 unit tests, 802 database checks, a coverage ratchet, and a scenario map in [testing.md](testing.md) |
| 15 | Production preparation | **Partly done** — error monitoring, environment separation and deployment are in; performance and structured logging are not. See below |

## Invariants

These hold across every phase. Breaking one is a regression regardless of what the phase was
supposed to deliver.

| Invariant | Why |
|---|---|
| **Mock payment only** | No Stripe, GCash, Maya, card or bank integration. `src/lib/env.ts` rejects any provider but `mock`. Every peso figure is test data and must be labelled as such in the UI. |
| **The server is the source of truth** | The client never decides a price, payment status, booking status, loyalty balance, or whether someone boarded. |
| **Privileged work goes through Edge Functions** | Never a direct table write from the client. |
| **RLS is never disabled** for convenience | A policy that is inconvenient in development is a policy about to ship broken. |
| **`trip_seats` has no client write policy** | Seat state changes only inside `SECURITY DEFINER` functions that can lock rows. A client able to `UPDATE` it could double-book. |
| **Roles are not self-assignable** | Enforced by Postgres column grants, not only by policy. |
| **The root layout stays light** | No auth gate, no native permission providers. `/payment/[reference]` renders in a logged-out stranger's browser through that same tree. |
| **`app.json` keeps `web.output: "single"`** | Otherwise a deep-linked payment reference 404s. |
| **MapLibre stays out of the web bundle** | Keep the `map.tsx` / `map.web.tsx` split, or the web build breaks and takes the payment page with it. |
| **Generated files are never hand-edited** | `src/types/database.ts` (`pnpm db:types`), app icons (`pnpm icons`). |

## Phases in detail

### Phase 1 — Foundation ✅

Expo SDK 57 + NativeWind, design tokens, UI primitives, brand mark and generated icons, validated
env, Supabase client, and the complete route tree with placeholder screens.

*Setup:* Node 22.13+, pnpm, Docker Desktop.

*Notes:* pnpm needs `.npmrc` to public-hoist `react-native-css-interop` or Metro cannot resolve
NativeWind's JSX transform. ESLint must stay on v9.

### Phase 2 — Authentication ✅

Sign-up, sign-in, sign-out, password reset, profile editing, role guards. Profiles are created by a
database trigger so a registration cannot half-succeed.

*Setup:* `supabase/config.toml` needs `site_url` and `additional_redirect_urls` pointing at the app,
or reset links go nowhere. Local mail is captured by Mailpit on `:54324`.

*Deviation:* pulled the `profiles` table forward from Phase 3 — authentication with nowhere to put a
person is not authentication.

### Phase 3 — Database foundation ✅

Operators, terminals, routes, buses, seat layouts, trips with trigger-generated seat inventory,
crew, RLS across all of it, seed data, and the RLS verification suite.

*Setup:* `pnpm db:start`, then `pnpm db:reset` to apply migrations and seed.

*Notes:* seeding `auth.users` directly requires four token columns set to `''` and a matching
`auth.identities` row, or sign-in fails with a misleading schema error.

### Phase 4 — Trip booking ✅

Trip search and filtering, trip details, passenger information, the visual seat map, atomic seat
reservation, booking creation, the passenger home screen, the tickets list, and the booking detail
screen with cancellation.

Every Phase 4 route is real. The remaining placeholders under `booking/` — `payment-qr` and
`confirmation` — belong to Phase 5, and `bookings/[id]` shows a labelled Phase 6 section where the
boarding pass will go, because a boarding pass before payment would be a security hole rather than a
missing feature.

*Depends on:* Phase 3 schema.

*The hard part:* `reserve_seats(p_trip_id, p_seat_ids, p_user_id)` must be a single transactional
RPC — lock the rows, clear expired holds, verify availability, create the booking and passenger
rows, write 10-minute holds, and return atomically. `SELECT` then `UPDATE` would let two passengers
take the same seat.

*Exit criteria — all met:* a booking reaches `PAYMENT_PENDING` with seats `HELD`; **eight
simultaneous callers race for one seat and exactly one wins**; overlapping seat sets requested in
opposite orders do not deadlock; expired holds return to `AVAILABLE`; the FK from
`trip_seats.booking_id` to `bookings` is added. Verified by `pnpm db:verify:booking` (38 checks).

*Notes:* `reserve_seats` drops `p_user_id` in favour of `auth.uid()` and folds `p_seat_ids` into
`p_passengers` — see docs/database.md for why. The `trip_search` view uses `security_invoker` so it
cannot become a way around RLS.

### Phase 5 — Mock payment ✅

Provider-agnostic payment layer, `MockPaymentProvider`, payment records, the payment QR, the public
web payment page, `confirm-test-payment`, receipts, and Realtime status.

*Setup:* Edge Functions need `supabase/functions/.env` (`PAYMENT_PROVIDER`, `WEB_PAYMENT_BASE_URL`).
`supabase start` serves them from the Edge Runtime container; `pnpm functions:serve` runs them
standalone. The QR must point at a LAN address, not localhost, to be scannable from another phone.

*Exit criteria — all met, verified by `pnpm db:verify:payment` (49 checks):* confirming **five times
leaves one payment, one receipt and one confirmation**; the mobile app updates over Realtime from a
confirmation performed in another browser; an expired payment cannot be confirmed; a wrong token is
indistinguishable from a missing payment; and no real provider is contacted.

*Notes:*
- `payments.token` is a 32-byte bearer secret carried in the QR. The public page has no session, so
  possession of that token is the credential. `get_public_payment` never returns it.
- `payments` carries a `provider = 'MOCK'` check constraint. Removing it should be a reviewed act.
- `MockPaymentProvider.acceptsClientConfirmation` is `true`; a real provider must return `false`,
  because a request from the payer's browser proves nothing about whether money moved. The confirm
  function checks that flag before doing anything.
- Edge Functions are Deno and are **excluded from `tsconfig.json`** — `jsr:` specifiers, `.ts`
  import extensions and the `Deno` global are all invalid in the React Native project.

### Phase 6 — Boarding QR ✅

Boarding passes issued only after payment, `validate-qr`, `confirm-boarding`, duplicate-scan
protection, the `qr_scans` log, and the operator scanner.

*Setup:* `QR_SIGNING_SECRET` in `supabase/functions/.env` — at least 32 characters. The functions
fail closed if it is missing or short, rather than issuing forgeable tokens. Camera scanning needs a
development build; `expo-camera` cannot scan on web, so the scanner falls back to manual entry there.

*Exit criteria — all met, verified by `pnpm db:verify:boarding` (38 checks):* no pass before
payment; **exactly one of six simultaneous scans boards the passenger**, the rest get
ALREADY_BOARDED; a forged, tampered or expired token is refused; a refunded ticket is invalid
despite a genuine signature; a passenger cannot validate their own ticket and a rival operator
cannot validate another operator's.

*Design notes:*
- The token is **HMAC-SHA256 signed**, not a stored random string. Signature proves authenticity;
  the database proves the ticket is still good. Both are required — a cancelled booking has a
  perfectly valid signature.
- `confirm-boarding` re-verifies the signature rather than trusting a `bookingId` from the client.
  Without that, an operator device could board any booking id it could guess.
- The signed payload wins over the surrounding JSON, so rewriting the outer `bookingId` around a
  real signature fails.
- The QR carries only booking id, reference and token — no names, no seats. Anything in a QR is
  readable by whoever photographs the screen.
- Manual entry on the scanner is a real operational path (cracked screen, dead phone), not just a
  test affordance. It goes through exactly the same server checks.

*Unverified:* camera scanning itself has never run on hardware — it needs a development build.
The whole path behind it is verified via manual entry, which uses the identical code.

### Phase 7 — Operator app ✅

Operator dashboard, travel data, passenger manifest, crew management, fleet list.

*Exit criteria — all met, verified by `pnpm db:verify:operator` (34 checks):* an operator sees only
its own trips, manifests and buses; a passenger and an anonymous caller see nothing in any operator
view, not even their own bookings; a rival operator cannot read a manifest, add crew to another
roster, or suspend another operator's driver; the dashboard's numbers track reality — a real booking
driven through payment and boarding moves passengers, revenue, seats and boarded counts by exactly
the right amounts.

*Design notes:*
- **Scoping lives inside the views, not in the callers.** `trips` and `buses` are readable by every
  signed-in user because trip search needs them, so RLS alone does not separate operators.
  `operator_trip_overview`, `operator_manifest` and `operator_fleet` all end in
  `where … = current_operator_id() or is_admin()`. This was not a precaution: a caller-side filter
  leaked a rival's data twice during this phase (see the deviations log).
- The views aggregate server-side. A dashboard that counts passengers per trip from the client is an
  N+1 over a Palawan mobile connection.
- `operator_dashboard` is SECURITY DEFINER with an explicit role check, and returns
  `scope: 'NO_OPERATOR'` for an admin rather than inventing figures — an admin is not tied to an
  operator, so there is nothing to total.
- **No on-time rate.** Nothing in the schema records actual departure against scheduled departure,
  so any percentage would be invented. The screen says so and shows real status counts instead.
  Phase 8's GPS supplies the missing data.
- **No SOS panel.** An "0 alerts" tile would read as a working monitor that happens to be quiet.
  The card says the feature arrives in Phase 11.
- The TEST DATA banner this screen carried was removed later, on request — see the note at the end
  of docs/payment-flow.md.

*Note:* the passenger-facing crew subset still needs a view or Edge Function — `drivers` and
`assistants` stay closed to passengers.

*Unverified:* the crew status toggle and add-crew modal were driven in the browser and confirmed
against the database, but nothing on this phase has run on hardware.

### Phase 8 — Realtime tracking ✅

Driver GPS publishing, `bus_locations`, the crew app, the trip lifecycle, the passenger tracking
map, and the on-time rate Phase 7 refused to invent.

*Setup:* `expo-location` (installed, foreground only). The **map itself needs a development build**
— MapLibre does not run in Expo Go or on web, so `map.web.tsx` says so rather than pretending.

*Exit criteria — all met, verified by `pnpm db:verify:tracking` (52 checks):* only the assigned
driver publishes, and only while the trip is live; an assistant, the owning operator, a passenger
and an anonymous caller are all refused; a driver cannot post under another driver's id or to a
trip they are not assigned to; **nobody can edit or delete a published position, including the
driver who wrote it and the operator who owns the bus**; tracking follows a paid booking — an unpaid
hold does not grant it and a refund takes it away; `start_trip` and `end_trip` are idempotent and a
retry does not move the recorded timestamp.

*Design notes:*
- **The GPS insert is a direct table write, guarded by RLS.** Every other privileged operation goes
  through an Edge Function; this one does not, because a ping per bus per ten seconds through a
  function buys nothing — there is no secret to hold and no cross-row invariant to keep. Trip
  *status* is different and does go through SECURITY DEFINER functions.
- **The trail is append-only.** No update, no delete, for anyone. A trail a driver can rewrite is
  not evidence of when the bus actually left.
- `driver_id` is defaulted from `current_driver_id()` rather than sent by the client, so a phone
  cannot name a driver at all.
- **`can_track_trip` is the whole authorisation model** and it is used by both the RLS policy and
  `trip_live_position`. Scoping lives inside the view, as in Phase 7.
- **Foreground location only.** `isAndroidBackgroundLocationEnabled` is false. Background tracking
  needs a separate Play Store declaration, and switching it on quietly would mean tracking a driver
  between trips. The crew account screen says this in as many words.
- **No estimated arrival.** Straight-line distance over an average speed is wrong on the Puerto
  Princesa–El Nido road, and a passenger who misses a connection because PalaGo guessed is worse
  off than one who was told nothing. The scheduled arrival is shown; the screen says why.
- Every degraded state is distinct and named: permission denied, location services off, no fix yet,
  patchy connection, repeated failures, and a stale last-known position with its age. A motionless
  marker with no explanation is the worst thing a tracking screen can show.
- Crew get their own route group. `(user)` no longer admits DRIVER or ASSISTANT.

*Unverified:* **the map has still never rendered on a device.** Everything behind it is verified —
the data, the authorisation, the Realtime updates, the honest states — but MapLibre itself needs
`npx expo run:android`, which this machine has not run. `expo-location` is likewise unexercised on
hardware; the publisher was verified through its error and permission states on web and through
direct inserts on the server.

### Phase 9 — Mock wallet ✅

Wallet balance, bounded test top-ups, an append-only ledger, and paying a booking from the balance.

*Exit criteria — all met, verified by `pnpm db:verify:wallet` (51 checks):* the balance always
equals the sum of the ledger, including under **eight concurrent top-ups**; no client can write a
balance or a ledger row, or edit or delete one afterwards; a wallet payment reaches the *same* end
state as a QR payment (PAID payment row, receipt, BOOKED seats, CONFIRMED booking, and a boarding
pass that issues); the amount is re-derived from the booking; paying twice charges once and
refunding twice credits once; a refund of a wallet-paid booking goes back to that wallet; an empty
wallet leaves the booking untouched rather than half-paid.

*Design notes:*
- **Balance and ledger move together, under one lock, in SECURITY DEFINER functions.** There is no
  client write path to either. `wallet_post` is private — not granted to anyone.
- **Ledger amounts are signed**, credits positive and debits negative, so `sum(amount) = balance` is
  one checkable invariant rather than a rule about which types subtract. The suite asserts it after
  every operation.
- **A wallet payment is a real `payments` row.** Anything less and the boarding pass, the operator
  manifest and the revenue totals would disagree about whether the passenger paid. Only
  `receipts.payment_method` distinguishes it: `PalaGo Wallet`.
- **Top-ups are bounded and idempotent on a caller-supplied key.** The bound is not security — a
  bounded fake balance is no safer than an unbounded one — but a wallet showing ₱90,000,000 makes
  every screen it appears on look broken. The key is what stops a double tap on a flaky connection
  minting balance.
- **Refunds are recognised by the ledger, not by a flag on `payments`**, so there is one source of
  truth, and the partial unique index on `(payment_id, type)` makes the credit-back idempotent for
  free.
- The wallet button on the payment screen is **disabled when the balance cannot cover the fare**,
  and says how much is short. An enabled button that fails on INSUFFICIENT_FUNDS teaches nothing.
- The home screen now shows the real balance. It still shows **no points total** — `loyalty_accounts`
  does not exist until Phase 10.

*Unverified:* nothing in this phase has run on hardware; it was verified in the browser and against
the database.

### Phase 10 — Loyalty ✅

Points balance and an append-only signed ledger, lifetime points, the rewards catalogue
(fixed-amount and capped-percentage discounts — no unenforced "perk" rewards), redemption against
an unpaid booking, and the passenger rewards screen.

*Exit criteria — all met, verified by `pnpm db:verify:loyalty` (49 checks):* points are **earned
only for travelling** — awarded inside `end_trip` when a booking becomes `COMPLETED`, computed from
what was actually paid, and **exactly once** (a unique index, not an `if not exists`); redeeming
applies a server-computed discount and stakes the points; cancelling the redemption, cancelling the
booking, or refunding it all return the staked points, and a redeem/undo loop never inflates
`lifetime_points`; one reward per booking; a client cannot write a balance, a ledger row, or make a
reward cheaper.

*Design notes:*
- **Balance and ledger move together** in `loyalty_post` (private, not granted), the same shape as
  the Phase 9 wallet. Signed amounts, so `sum(points) = points_balance` is one checkable invariant.
- `lifetime_points` only ever rises and only counts `EARNED` / `BONUS` — spending a point does not
  undo the fact that you earned it, and returning a staked point does not re-earn it.
- Awarding at payment would be easier and wrong: a passenger who pays and never boards would collect
  points for an empty seat, and a refund would then have to claw them back.

*Unverified:* nothing in this phase has run on hardware; verified in the browser and against the
database.

### Phase 11 — SOS ✅

Passenger-raised emergency alerts with location capture, and the operator-side workflow that drives
one through acknowledge → responding → resolved.

*Setup:* `expo-location` (already installed for Phase 8, foreground only).

*Exit criteria — all met, verified by `pnpm db:verify:sos` (40 checks):* a passenger can raise an
alert and **a second press while it is still open returns the same alert**, not a second emergency;
`sos_incidents` has no client write path at all — nobody can INSERT, UPDATE or DELETE a row,
including the passenger who raised it and the operator responding to it; the operator running the
trip sees it and a **rival operator sees nothing and cannot acknowledge or resolve it**; another
passenger and an anonymous caller see nothing; the transitions are idempotent, a resolved alert
cannot be walked backwards, and the passenger may cancel their own false alarm but **not once a
responder is already on the way**; every transition is audited and notified.

*Design notes:*
- **One open alert per passenger**, enforced by a partial unique index rather than a check in the
  function. Someone in trouble presses the button repeatedly; `trigger_sos` catches the violation
  and returns the alert that already exists with `alreadyOpen: true`. A second row would split one
  emergency into two half-attended ones.
- **The trip is resolved server-side** from the caller's own booking. A client-supplied `trip_id`
  would let anyone attach an alert to a trip they are not on, and the operator scoping is built on
  that column.
- **`trip_id` is nullable on purpose.** An emergency before boarding is still an emergency, so the
  alert is not refused for want of an active booking — it simply has no operator to scope to, and
  is visible to admins only.
- Status transitions share one private `sos_advance`, so the guard, the lock, the idempotent branch,
  the audit row and the notification exist once rather than four times.
- **No promise the app cannot keep.** The screen does not say "help is on the way" until a responder
  has actually said so, and it says plainly that PalaGo does not contact emergency services for you.
- The operator's resolve dialog is a `Modal` with a text field, not `Alert.prompt` — that exists
  only on iOS, so on Android and web the operator would tap Resolve and watch nothing happen.

*Unverified:* nothing in this phase has run on hardware. `expo-location` is exercised only through
its permission and error states on web; the capture itself needs a development build, the same gap
Phase 8 records.

*Fixed after the fact (20260919000038):* the first cut alerted nobody. `trigger_sos` notified only
the passenger, so the operator, the driver and the crew learnt of an alert only if the operator
dashboard happened to be open; RLS hid the passenger's name and phone from the responders, who got
bare coordinates; drivers and admins had no SOS screen at all, so an alert raised before boarding
was seen by no one; the passenger was told "help is being arranged" before anyone had seen it; and
the trip was the most recently *created* live booking rather than the one under way. Now every
responder (the trip's operator admins, its rostered driver and crew, every admin) gets a
notification — which fires the push webhook — and `sos_incident_details` gives them name, phone,
trip, coach and route for the incidents `can_manage_sos` already lets them act on. The shared
`SOSMonitor` is on the operator dashboard, the driver's roster and the admin overview, with Call and
map buttons. The passenger's location request now times out after 12 s and falls back to the last
known fix — it had no timeout, and indoors could hang the button on "Getting your location…"
indefinitely. `pnpm db:verify:sos`: 57 checks; the 17 new ones red-ran with 9 failures against the
old functions.

### Phase 12 — Notifications

In-app feed and push delivery. The rows are already written by payment, boarding, loyalty and SOS —
the feed that displays them and the push transport are not.

*Setup:* needs Expo push credentials for real device delivery.

### Phase 13 — Security review

RLS review, role review, QR and payment security, authorisation, audit logs, rate limits. Work
through the attack list in [security.md](security.md): double booking, duplicate payment
confirmation, duplicate boarding, forged QR, cancelled and unpaid ticket scanning, expired payments
and holds, unauthorised operator/location/SOS access.

### Phase 14 — Testing

Broaden coverage to the full scenario list in [testing.md](testing.md), with particular attention to
concurrency and idempotency — the guarantees a passing happy-path test says nothing about.

### Phase 15 — Production preparation

Performance, error monitoring, logging, environment separation, deployment. Three of the five are
done; the other two are named here rather than quietly dropped.

| Item | State |
|---|---|
| **Error monitoring** | **Done.** EAS Observe records startup, navigation and crash metrics; `AppErrorBoundary` catches render-phase errors with their component stack and shows a real screen instead of a white one. See [observability.md](observability.md). |
| **Environment separation** | **Done.** `eas.json` links each build profile to an EAS environment; `scripts/check-build-env.mjs` fails a build whose variables are missing or point at localhost; `scripts/_verify-env.mjs` keeps the verify suites off any hosted project. |
| **Deployment** | **Done.** `pnpm deploy:check` refuses to ship a client the target database cannot serve — see the Android and web halves of [deployment.md](deployment.md). |
| **Performance** | **Not done.** The 5.6 MB web entry bundle is unsplit; `bus_locations` is append-only with no retention job (~1.3 GB/month at province-wide scale); and realtime fan-out from a 10-second GPS interval is the second-largest projected running cost. All three are sized in [production-costs.md](production-costs.md) §8. |
| **Structured logging** | **Not done.** The Edge Functions `console.log`; nothing is correlated by request or aggregated. `Observe.logEvent` and `Observe.reportError` are installed and unused. |

## Deviations log

Scope moves between phases are recorded here rather than left implicit.

| Moved | From → To | Reason |
|---|---|---|
| `profiles` table, role enum, RLS | 3 → 2 | Authentication needs somewhere to put a person |
| Operator account screen | 7 → 2 | Phase 2 owns sign-out; an operator who cannot sign out is a broken build |
| `trip_seats` | 4 → 3 | A trip without seat inventory is not usable by search |
| Service stubs | 1 → owning phase | Signatures guessed against a schema that did not exist would be rewritten anyway |
| Brand, theme and MapLibre | — | Requested mid-build; cross-cutting, applied across Phases 1-3 output |
| `trip_search` view | 4 (added) | Search needs operator, terminals, bus and a live seat count without an N+1 |
| Second seeded passenger | 4 (added) | An admin cannot stand in for "another user" when testing isolation — it is allowed to see everything |
| `audit_logs`, `notifications` | 13, 12 → 5 | A payment confirmation that leaves no audit trail and notifies nobody is not something to add afterwards |
| Stale-session sign-out | 13 → 5 | A token whose user no longer exists passed the route guard and then dead-ended every query on "could not load"; hit three times in development after `db:reset` |
| `operator_fleet` view | 7 (added) | The fleet screen read `buses` directly. `buses` is world-readable for trip search, so a Cherry account was shown RoRo's coaches — caught in browser verification, not by RLS |
| On-time rate | deferred in 7 → 8 | Needed `trips.actual_departure_at`, which only exists once a driver can start a trip |
| Trip lifecycle (`start_trip`, `end_trip`) | 8 (added) | Tracking a bus is meaningless without something that says the bus is running, and the on-time rate needs the timestamps |
| Crew app `(driver)` | 7 → 8 | A driver has to publish GPS from somewhere, and the operator console correctly refuses them |
| `fromRpcError` moved to `@/lib/errors` | 8 | The tracking RPCs need the same code-in-the-message translation the booking RPCs use |
| `BoardingScanner` extracted | 8 | Crew scan at the door and operators scan at the terminal; two copies of the scan-result wording would drift |
| `refund_test_payment` rewritten | 9 | A wallet-paid booking refunded without crediting the wallet back would lose the passenger's test money; the refund now returns it to where it came from |
| Wallet balance on the home screen | 9 | Phase 8's home screen said "wallet and rewards are not built yet"; half of that stopped being true |
| SOS schema rewritten before it ever applied | 11 | The first cut referenced `trip_assignments.assigned_to` and an `audit_log_trigger()` that does not exist, so `db:reset` and `db:push` both failed outright. Rewritten to the conventions the other ten phases use — a real enum, bounded coordinates, `search_path = ''`, grants, no client write path — rather than patched to merely apply |
| `cancel_sos` and `respond_sos` | 11 (added) | `SOSStatus` already carried RESPONDING and CANCELLED, and nothing set either. A status an enum promises and no code path reaches is a lie in the type |
| Trip search status filter | 12 → 14 | The plan for `20260915000032` said `searchTrips` would filter on the new `operator_status` / `bus_status` / `route_status` / `is_active` columns. The migration shipped them and the client never used them, so a passenger could pick a departure on a withdrawn coach and only be refused at payment. Found while writing the tests that now guard it |
| Performance and structured logging | 15 → deferred | Named in [production-costs.md](production-costs.md) §8 with the numbers behind them. Neither is a correctness risk; both are cost and operability |
| Rate limiting | 13 → deferred | Assessed rather than built. The brute-force vectors are already closed by Supabase Auth's sign-in limit and a 256-bit payment token; what remains is resource abuse, which a Postgres counter does not solve and a CDN does. Recorded in [security-review.md](security-review.md) §3.1 |
| Admin console | Unplanned, built on request | Not in the fifteen-phase plan. An ADMIN previously landed on the passenger home with no surface of their own, and reference data could only be added by editing `seed.sql`. Scope was held to analytics plus operators, terminals, routes and buses; trip scheduling stays with the operator console |

## Commands

```bash
pnpm check
```

```bash
pnpm db:verify:all
```

`db:start` · `db:reset` · `db:types` · `db:stop` · `icons` · `web` · `android` · `start`
