# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# PalaGo

Transportation booking for Cherry Bus and RoRo Bus. See [README.md](README.md) for the phase plan
and [docs/](docs/) for architecture, payment, QR, realtime, security and testing.

## Non-negotiables

- **No payment provider — but cash is now real money.** No Stripe, GCash, Maya, card or bank
  integration. `src/lib/env.ts` still rejects any online provider other than `mock`, and both
  guards stay until a real one is deliberately added. What changed, on request, is cash:
  `record_counter_payment` records a fare handed to a clerk at a counter, so `payments.provider`
  is constrained to `MOCK` **or `CASH`**, and a CASH row must name the member of staff who took
  it (`received_by`). That row is the only record the money exists. Only an operator manager or
  admin may write one; no client can mark anything paid. Every other payment in this build is
  still simulated and moves nothing.
- **The test-mode notices were removed once and are being put back on request.** They were
  stripped from every screen (along with `TEST_MODE_LABEL` and `TEST_PAYMENT_WARNING`); the current
  specification asks for them again. So far only the counter screen has one — it says TEST PAYMENT —
  NO REAL MONEY WILL BE CHARGED for the simulated methods, and something quite different for cash.
  The passenger-facing payment, receipt, wallet and ticket screens still say nothing, so a receipt
  or a balance there remains visually indistinguishable from a real one. Restoring those is
  outstanding work, not a decision to leave them off.
- **The server is the source of truth.** The client never decides a price, a payment status, a
  booking status, a loyalty balance, or whether someone boarded. Privileged operations go through
  Edge Functions, never direct table writes.
- **Never fake success.** No hardcoded success responses, no confirming a payment in React state, no
  reporting a feature as done because a screen renders. Unfinished routes use `PlaceholderScreen`,
  which says which phase will implement them.
- **RLS is never disabled** to make frontend work easier.
- **Phases are sequential.** Do not start a phase until the previous one passes `pnpm check` and its
  browser verification. The full process — gate checklist, per-phase scope and setup, invariants and
  the deviations log — is in [docs/phases.md](docs/phases.md). Read it before starting a phase.

## Conventions

- Money is integer centavos. Format with `@/utils/money`, never do currency maths in floats.
- Statuses come from `src/constants/enums.ts` — no inline status strings.
- Errors use the codes in `src/constants/errors.ts`.
- Screens compose; services own Supabase access; hooks wrap services in TanStack Query. Screens do
  not call Supabase directly.
- Zustand holds client state only. Server state lives in TanStack Query.
- Styling is NativeWind classes; `src/constants/theme.ts` holds raw values for the places that
  cannot take class names. Change both together.
- Avoid `any`. Touch targets ≥44px. Icon-only buttons require an `accessibilityLabel`. Status is
  never conveyed by colour alone.
- Every feature screen handles loading, empty, error and offline — use `src/components/ui/states.tsx`.

## Gotchas already paid for

- **The root layout must stay light.** No auth gate and no native permission providers in
  `src/app/_layout.tsx` — the public `/payment/[reference]` page renders in that same tree in a
  logged-out browser. Gate inside `(user)` / `(operator)` instead.
- **`app.json` keeps `web.output: "single"`**, or deep-linked payment references 404.
- **pnpm + Metro**: `.npmrc` public-hoists `react-native-css-interop`. Removing it breaks the bundle
  with "Unable to resolve react-native-css-interop/jsx-runtime".
- **ESLint must stay on v9.** v10 breaks `eslint-plugin-react` as bundled by `eslint-config-expo`.
- **RNTL v14**: `render` is async (`await render(...)`) and interactions use `userEvent`.
- **Typed routes**: dynamic hrefs need the object form,
  `{ pathname: '/payment/[reference]', params: { reference } }`.
- **`nativewind-env.d.ts` is committed** — it is hand-written, and `tsc` fails without it.
- **Route groups do not appear in the URL.** `(user)/profile.tsx` and `(operator)/profile.tsx` both
  resolve to `/profile` and collide silently — the route falls through to somewhere else entirely.
  Give same-named screens in different groups distinct filenames (the operator one is `account.tsx`).
- **`/reset-password` lives at the router root, not in `(auth)`.** The recovery link creates a real
  session, so an `(auth)` layout would redirect the user away from the form they came to use.
- **`src/types/database.ts` is generated.** Run `pnpm db:types` after a migration; never hand-edit.
- **`trip_seats` has no client write policy, deliberately.** Seat state changes only inside
  SECURITY DEFINER functions that can lock rows. A client able to UPDATE it could double-book.
- **The operator console must read `operator_*` views, never `trips` or `buses` directly.** Both
  tables are readable by every signed-in user because trip search needs them, so RLS does not
  separate operators. The filter lives inside `operator_trip_overview`, `operator_manifest` and
  `operator_fleet`. Reading a base table leaked a rival's coaches to the Cherry fleet screen.
- **`bus_locations` is append-only and its insert is a direct table write.** That is the one
  deliberate exception to "privileged operations go through Edge Functions" — a GPS ping has no
  secret and no cross-row invariant, only "is this the assigned driver", which RLS expresses
  exactly. No client may UPDATE or DELETE it. Trip *status* is not an exception: it goes through
  `start_trip` / `set_trip_boarding` / `end_trip`.
- **Crew authorisation must not depend on an assignment still being live.** `end_trip` sets the
  assignment to COMPLETED; checking for ASSIGNED/ACTIVE made `end_trip` non-idempotent in practice
  (the guard raised FORBIDDEN before the "already ended" branch could return) and 404'd the driver's
  own trip screen the moment they ended it. Ask "were you the crew", not "are you still on duty".
- **The wallet balance and its ledger are written together or not at all.** `wallets` and
  `wallet_transactions` have no client INSERT/UPDATE/DELETE policy; everything goes through
  `top_up_wallet` / `pay_booking_with_wallet` / `refund_test_payment`, which hold the wallet row
  lock. Ledger amounts are **signed**, so `sum(amount) = balance` is the invariant to check.
- **A wallet payment must produce a real `payments` row and receipt.** The boarding pass, the
  operator manifest and the revenue totals all read those; a wallet payment that only moved a
  balance would leave a passenger who paid looking unpaid at the door.
- **An authorisation check comparing against a nullable column must be `coalesce(…, false)`.**
  `current_operator_id()` is NULL for a passenger, so `p_operator_id = public.current_operator_id()`
  is NULL, `public.is_admin() or NULL` is NULL, and `if not NULL then raise` never fires. The first
  cut of `create_bus` therefore let any signed-in passenger add a bus to any operator's fleet, with
  no error returned. Comparisons inside an `exists (…)` subquery are safe (no rows means false); a
  bare comparison in an `if` is not. Assert the *effect* in the verify suite, not just the error
  message — checking only the message would have passed that function.
- **Run `pnpm db:verify` after any migration touching a policy** — 31 RLS checks against real
  signed-in roles. Unit tests cannot cover RLS.
- **Do not set `"jsx"` in tsconfig.json.** `expo/tsconfig.base` sets `react-jsx`; overriding it with
  `react` breaks every `.tsx` file with "React refers to a UMD global".
- **Seeding auth.users directly** needs `confirmation_token`/`recovery_token`/
  `email_change_token_new`/`email_change` set to `''` and a matching `auth.identities` row, or
  sign-in fails with the misleading "Database error querying schema". See docs/database.md.
- Guards (`AuthGate`) are navigation only. Data access is enforced by RLS — see docs/auth.md.
- **MapLibre is native-only.** No Expo Go, no react-native-web. Keep the `map.tsx` / `map.web.tsx`
  split — importing MapLibre into the web bundle breaks the public payment page. See docs/realtime.md.
- **react-native-svg: use `transform="translate(x y)"`, not `translateX`/`translateY` props.** Those
  are native-only and leak to the DOM on web as unknown React attributes.
- **App icons are generated** from `assets/brand/palago-icon.svg` by `node scripts/generate-icons.mjs`.
  Never hand-edit the PNGs in `assets/images/`. Palette and logo rules: docs/brand.md.
- **Seats are assigned when the payment is verified, not when the booking is made.**
  `create_booking` (which replaced `reserve_seats`, dropped rather than kept) holds *capacity* —
  as many seats as the booking needs, anonymously, for ten minutes — and
  `assign_seats_for_booking` gives named passengers their seat numbers from the payment functions.
  So `booking_passengers.seat_id` is nullable, and any PostgREST embed of `bus_seats` must be a
  plain embed: `bus_seats!inner(...)` silently drops every passenger on an unpaid booking, which is
  how the public payment page once listed nobody at all. Releasing a seat (cancel, refund, expiry)
  clears the assignment with it.
- **A booking need not have an account holder.** A walk-in sold at a counter has
  `bookings.user_id = null`; `created_by` records the clerk. Anything keyed to an account must
  tolerate the absence of one — `award_loyalty_for_booking` returns early for a null owner, and
  without that guard one walk-in aboard made `end_trip` fail for the whole busload. Notifications,
  wallets and loyalty all belong to accounts; counter sales have none.
- **The manifest is who is travelling.** `operator_manifest` filters to live booking statuses. It
  had no such filter and listed cancelled and refunded passengers — 26 of them on the seeded
  database — in seats that had since been resold, while the passenger *count* on the same trip
  already excluded them.
- **Seeded trip numbers embed the date they were generated for** (`CHERRY-0912-B`), so a test that
  hardcodes one passes the day it is written and fails the next morning. Pick trips by relationship
  instead — same route another day, another route, a departed one — the way `verify-boarding` does.
  Suites also share seed state: `verify-tracking` must pick a trip *neither* test passenger has a
  live booking on, because a paid booking is what buys tracking and the seed gives passenger2 one.
- **A scan is judged against the trip being boarded, and that trip is not optional.** Both
  `validate_booking_qr` and `confirm_boarding` take the door's trip; the old, trip-less versions were
  dropped rather than left as overloads, because an unscoped function still on the database is still
  callable over RPC. Both reach their verdict through `boarding_verdict`, so the screen and the
  database cannot disagree. Anything new that boards someone must go through it.
- **Boarding is per passenger.** `booking_passengers.boarded_at` is the truth; the booking's own
  `boarded_at` only marks that *someone* on it boarded. Count boarded passengers from the passenger
  rows — counting bookings in status BOARDED says a family of four boarded when one did.
- **Refused scans are returned, not raised.** A `raise` after writing the `qr_scans` row rolls the
  row back, which is how refused boardings went unlogged for three phases. Return the verdict.
- **Drivers and assistants are crew, not managers.** They carry an operator id, so any policy that
  only asks "is this row my operator's?" grants them the whole company: before
  `20260911000024_staff_write_scope.sql` a driver could reprice a trip, mark it COMPLETED, or cancel
  a crew assignment — and assignments are what `can_scan_trip`, `can_manage_trip_status`,
  `can_publish_location` and `can_manage_sos` all trust. Write policies on operator-owned tables use
  `can_manage_operator(...)`, which requires the OPERATOR role. Test new policies as a driver, not
  only as a passenger and a rival operator.
- **Trip status is not writable from any client, including admins.** `trips` grants UPDATE on
  specific columns only, so `status`, `actual_departure_at` and `actual_arrival_at` move through
  `set_trip_boarding` / `start_trip` / `end_trip` and nothing else. A direct status write skips the
  booking transitions and the loyalty award.
- **A claimed passenger type is not a discount.** `booking_passengers.passenger_type` comes straight
  from the client. It was harmless while it did not touch the price; since the senior/student/PWD
  discount, it does. `reserve_seats` therefore keys the 20% off an APPROVED `discount_eligibilities`
  row — which no client can write — never off the claimed type alone. Anything new that prices by
  passenger type must do the same, or typing SENIOR becomes a free 20% off.
- **Uploading an ID is not approval.** A `discount_eligibilities` row starts PENDING and discounts
  nothing until an operator or admin approves it through `review_discount_eligibility`. The proof
  bucket `discount-proofs` is private and holds government IDs: read them only through a short-lived
  signed URL, never a public one.
- **On web, expo-camera's permission status cannot explain a failure.** No camera, a plain-HTTP page
  (where browsers remove `navigator.mediaDevices`), and a camera held by another app all come back
  as `DENIED`, with `canAskAgain: true` even though a browser never re-prompts after a block. Check
  `src/lib/web-camera.ts` before trusting the status, or the operator gets an "Allow" button that
  does nothing. Web scanning needs HTTPS or `localhost` — a LAN `http://` dev URL has no camera.
- **Do not set the image picker's `cameraPermission` to `false`.** It looks like the way to stop the
  picker touching the camera, but it *blocks* `android.permission.CAMERA` and breaks the boarding
  scanner. Leaving it unset is also wrong — the picker then overwrites the scanner's permission text
  with Expo's generic one. `app.json` gives it the scanner's exact string, so either plugin order
  produces the right prompt.
- **The `verify-*.mjs` suites write test data, so they only ever target the local stack.** They
  create bookings, payments, wallet top-ups and boarding scans. `scripts/_verify-env.mjs` uses `.env`
  only when it points at localhost; otherwise it ignores it and reads the local stack's URL and key
  from `supabase status`, so `.env` can stay pointed at the hosted project. A remote run needs
  `VERIFY_ALLOW_REMOTE=1`. New suites must load their target through `loadVerifyEnv()` — never read
  `.env` directly again; that is how `db:verify:all` used to write test money into production.
- **A subscription's `SUBSCRIBED` is not a promise that it is receiving yet.** Realtime
  acknowledges the channel before the subscription is visible to the process reading the
  write-ahead log, and a row written inside that window is missed outright — nothing is replayed.
  On its own `verify-notifications` passed every time; after the other eleven suites had run it
  failed every time, which looks exactly like a missing publication and is not. The window widens
  when the replication stream is busy. Anything that subscribes and then immediately causes its own
  event has to allow for it.
- **The verify suites are only meaningful straight after `pnpm db:reset`.** Tracking and loyalty
  consume seed state — they depart the seeded trips and award points — so a second run fails on
  "a SCHEDULED Cherry trip exists" and "with no points", with no code having changed. Reset, then
  run once. An occasional "a tampered signature is invalid" failure was once blamed on a cold Edge
  container; the real cause was the test flipping the signature's final base64 character, whose
  low bits are padding — one run in sixteen the "tampered" copy decoded to the same bytes. The test
  now tampers a significant character, and the verifier rejects non-canonical spellings. If a
  security check fails intermittently, find the mechanism; don't warm something and re-run.

- **Account status and availability are two fields and must stay two fields.**
  `profiles.account_status` says whether somebody may sign in;
  `drivers.availability_status` / `assistants.availability_status` say whether they may be given a
  new trip. A driver on a rest day is ACTIVE + UNAVAILABLE — they open the app, see their history,
  and are not rostered. The single `staff_status` these replaced could not express that at all, so
  it was dropped rather than left alongside them. Never add a third status that means "sort of
  both".
- **`active_uid()`, not `auth.uid()`, in any policy that asks "is this row mine?"** The role
  helpers (`is_admin`, `current_operator_id`, `current_driver_id`, `current_assistant_id`) are
  gated on `account_status`, but nineteen policies tested `auth.uid()` directly and kept answering
  a deactivated account — its token stays syntactically valid for up to an hour after the door
  closes. `active_uid()` is `auth.uid()` for an account that may sign in and NULL for one that may
  not. The single exception is reading your own profile, which stays open so the app can say why it
  stopped working.
- **A schedule clash is a constraint, never a check.** `trips.blocked_range` is the journey plus a
  turnaround buffer, and `EXCLUDE USING gist (bus_id WITH =, blocked_range WITH &&)` makes an
  overlap impossible under concurrency — two operators pressing Save at the same instant would both
  read "free" from a check-then-insert and both write. `trip_assignments` carries a copy of its
  trip's window for the same reason, because an exclusion constraint can only read its own table;
  two triggers keep the copy honest. The buffer is configuration, which is why `blocked_range` is
  trigger-maintained and not a generated column: a generated column must be IMMUTABLE and cannot
  read a setting.
- **Cancelling or withdrawing a trip must release its crew, not just its coach.** The constraints on
  `trip_assignments` read the assignment's own status, not its trip's, so an assignment left
  ASSIGNED on a cancelled trip goes on blocking that driver for a journey nobody is making. Caught
  by running `verify-schedules` twice: the second run failed on a conflict the first run had left
  behind.
- **An arrival at or before the departure time is the next day.** `trip_arrival_timestamp` and
  `src/utils/schedule.ts` both encode it, and they have to agree — an overnight sailing leaving at
  20:00 and arriving 06:00 is ten hours, not minus fourteen, and getting it backwards makes every
  overnight departure look free. `timestamp`, never `timestamptz`: Palawan is one zone and
  timestamptz arithmetic depends on the session's TimeZone, so two clients would disagree about
  what overlaps.
- **Reference data has no delete, for anyone.** Operators, terminals, routes, buses and trips are
  referenced by bookings, payments, tickets and boarding scans, so every "Delete" in the console is
  deactivation and every write goes through an audited function — the client INSERT/UPDATE/DELETE
  on all five was withdrawn. A suite that used to clean up with `DELETE` now stands its fixtures
  down instead, and stamps its codes per run because the rows stay.
- **Only an admin creates an operator account, and nobody creates an admin.** `manage-staff` is the
  one path to an account somebody else will use; it needs the service-role key, so it is an Edge
  Function, and every rule it applies is asked of SQL as the signed-in caller. It authorises BEFORE
  creating the auth user, so a refusal leaves no orphan, and deletes the user if provisioning then
  fails — a compensating write, not a rollback, and logged loudly when even that fails.
- **Do not assume the seeded driver is on a given trip.** Cherry Bus has more departures than one
  driver can legally cover, so the seed allocates crew greedily and which of its two is on a trip is
  the allocator's decision. `verify-boarding` resolves the door's crew from the assignment and signs
  in as them; a test that hardcodes `driver@palago.test` breaks the next time the schedule moves and
  says nothing about the code.

## Commands

```bash
pnpm check
```

`typecheck` · `lint` · `test` · `web` · `android` · `db:start` · `db:reset` · `db:types`

`pnpm db:verify:all` runs fifteen suites against the local stack. It needs
`pnpm functions:serve` running — and exactly one copy of it: two `supabase functions serve`
processes fight over the edge-runtime container and take it down, which surfaces as
`503 name resolution failed` and looks like a broken function.

The web dev server runs on port 8090 (8081 is taken on this machine).
