# Database

## Status

Phases 2-3 are applied: identity, reference data, trips and seat inventory, and crew. Booking,
payment, wallet, loyalty, SOS and notification tables arrive with their own phases.

`src/types/database.ts` is generated from the live schema and must never be hand-edited. After
every migration:

```bash
pnpm db:types
```

### Applied migrations

| Migration | Contents |
|---|---|
| `20260908000001_auth_profiles.sql` | `user_role`, `profiles`, RLS, sign-up trigger, `is_admin()` / `current_profile_role()`, `set_updated_at()`, column grants |
| `20260909000001_reference_data.sql` | `operators`, `terminals`, `routes`, `buses`, `bus_seats`; `profiles.operator_id` + `current_operator_id()` |
| `20260909000002_trips.sql` | `trips`, `trip_seats`, inventory trigger, `trip_available_seats()` |
| `20260909000003_crew.sql` | `drivers`, `assistants`, `trip_assignments`, `current_driver_id()` / `current_assistant_id()` |

## Conventions

- **Money is integer centavos.** ₱450.00 is stored as `45000`. Floating-point pesos drift across
  `fare × passengers − discount` and stop matching the server's total. `src/utils/money.ts` converts
  at the display edge only. `integer` caps a single amount near ₱21.4M — ample for a fare, and it
  avoids `bigint` arriving in JavaScript as a string.
- **Enums are Postgres enums** mirroring `src/constants/enums.ts` exactly. Adding a status means
  changing both in the same change.
- **Every schema change is a migration.** No structure is created from application code.
- **RLS on every table**, from the migration that creates it.
- `set_updated_at()` is shared — attach it to every new table rather than writing another trigger
  function.

## Authorisation model

Two columns decide everything:

- `profiles.role` — *what kind* of account this is.
- `profiles.operator_id` — *whose*. Every operator-scoped policy resolves through it.

Both are administrative: the Phase 2 column grants exclude them from what an account holder may
update.

Four `SECURITY DEFINER` helpers back the policies — `is_admin()`, `current_operator_id()`,
`current_driver_id()`, `current_assistant_id()`. They are `SECURITY DEFINER` so that a policy on
`profiles` or `drivers` can read those same tables without recursing into its own policy.

### Who can read what

| Table | Read | Write |
|---|---|---|
| `operators` `terminals` `routes` `buses` `bus_seats` `trips` | any signed-in user — you cannot search for a trip without them | owning operator + admin |
| `trip_seats` | any signed-in user (the seat map) | **nobody from a client** |
| `drivers` `assistants` `trip_assignments` | owning operator, the person themselves, admin | owning operator + admin |
| `profiles` | own row, admin | own row, restricted columns |

`drivers` and `assistants` are deliberately *not* world-readable. A passenger has no business
enumerating crew names, licence numbers and phone numbers; the passenger-facing subset (the driver's
name on a trip they hold a ticket for) is exposed through an Edge Function in Phase 7 rather than by
opening the table.

There is no `anon` access to anything. The public payment page reads through an Edge Function.

## Seat inventory

`bus_seats` describes the **vehicle**. `trip_seats` is the **sellable inventory for one departure**.

Inventory is created by a database trigger when a trip is inserted, not by whoever inserted it — a
trip that silently has no sellable seats is a failure mode worth designing out. `DRIVER` seats are
excluded.

`trip_seats` has **no client write policy at all**, and INSERT/UPDATE/DELETE are revoked from
`anon` and `authenticated`. Seat state changes only inside `SECURITY DEFINER` functions, which can
lock rows and verify availability atomically. A client that could `UPDATE trip_seats` could
double-book a seat, and no amount of care in the app would prevent it.

`trip_available_seats(trip_id)` counts what is bookable, treating an expired hold as available so a
stale hold never makes a trip look full before the sweep runs.

`trip_seats.booking_id` has no foreign key yet — `bookings` arrives in Phase 4, which adds the
constraint.

## Indexes

Trip search runs on `trips (route_id, departure_date, status)`. Seat lookups use
`trip_seats (trip_id)` and `(status)`, plus a partial index on `held_until where status = 'HELD'`
for the expiry sweep. Foreign keys used in policies (`operator_id`, `user_id`, `trip_id`) are all
indexed — an unindexed column inside an RLS policy is a sequential scan on every query.

## Verifying RLS

Unit tests cannot cover RLS; the policies live in Postgres. `scripts/verify-rls.mjs` signs in as
each seeded role through the ordinary publishable key and asserts what each may and may not do:

```bash
pnpm db:verify
```

31 checks, covering anonymous access, passenger reads and writes, operator isolation between Cherry
Bus and RoRo Bus, the seat-inventory write ban, driver self-access, and admin reach. **Run it after
any migration that touches a policy.**

## Local development

```bash
pnpm db:reset
```

Re-applies every migration and runs `supabase/seed.sql`.

### Seed data

Two operators (Cherry Bus, RoRo Bus), six Palawan terminals (Puerto Princesa, El Nido, Coron, Roxas,
Brooke's Point, Taytay), nine routes, five buses with generated 2+2 seat layouts (row 1 priority),
ten trips dated relative to `current_date`, crew, assignments, and a couple of blocked seats so the
seat map has something other than `AVAILABLE` to render.

Seven test accounts, all with password `PalawanGo2026`. **[test-accounts.md](test-accounts.md) is
the full list** — roles, operators, where each lands, and what each is for. It is kept in one place
so the copies cannot drift; this section deliberately does not repeat it.

Accounts are inserted straight into `auth.users`, because there is no sign-up request to make from
SQL. Two details are easy to get wrong and produce baffling errors:

- `confirmation_token`, `recovery_token`, `email_change_token_new` and `email_change` have no column
  default, and GoTrue reads them into non-nullable Go strings. Left NULL, every sign-in fails with
  *"Database error querying schema"*, which points nowhere near the real cause. Seed them as `''`.
- A matching `auth.identities` row is required or email sign-in will not work.

The Phase 2 sign-up trigger still fires for seeded users, so each gets a profile automatically;
roles and operator membership are applied immediately afterwards.

## Pushing migrations to production

```bash
SUPABASE_PROJECT_REF=<ref> pnpm db:push:prod -- --yes
```

Links to the given cloud project and runs `supabase db push`, applying every pending file under
`supabase/migrations/`. **Schema only.** `supabase/seed.sql` is never applied by this script, or by
any prod workflow — it is test accounts, test trips and test money, and AGENTS.md says explicitly it
must never reach a real project. Needs `supabase login` to have been run once on the machine (or
`SUPABASE_ACCESS_TOKEN` set) so the CLI is authenticated.

### Seeding a staging / demo project

To sign in to a hosted deployment you need accounts there. `supabase/seed.cloud.sql` is a trimmed,
re-runnable version of the seed with **accounts and schedule only** — the seven test accounts, the
two operators, terminals, routes, buses, seat layouts, crew and a rolling set of trips — and none
of the fabricated bookings, payments, receipts, wallet balances, loyalty points or scans. Run it
**after** the migrations are pushed, from the Supabase Studio SQL editor or with
`psql "<connection string>" -f supabase/seed.cloud.sql`. Point it at a staging/demo project, never
at a system meant to be a record of truth.

## Booking and seat reservation (Phase 4)

| Migration | Contents |
|---|---|
| `20260909000004_bookings.sql` | `booking_status`, `passenger_type`, `bookings`, `booking_passengers`, the reference sequence, the deferred `trip_seats.booking_id` FK |
| `20260909000005_reserve_seats.sql` | `reserve_seats`, `cancel_booking`, `expire_seat_holds` |
| `20260909000006_trip_search.sql` | the `trip_search` view |

### `bookings`

Read-only from the client: no INSERT, UPDATE or DELETE policy exists and those
privileges are revoked. A client able to INSERT could set its own total; one able
to UPDATE could mark itself `CONFIRMED` without paying.

Two constraints are worth noting because they make a class of bug impossible
rather than merely unlikely:

- `bookings_total_adds_up` — `total_amount = subtotal - discount - loyalty_discount`,
  checked by the database. A future bug cannot persist a total that does not add up.
- `booking_reference` defaults from a **sequence**, not a row count. Two
  concurrent bookings counting existing rows would compute the same reference.

### `reserve_seats(p_trip_id, p_passengers)`

The signature deviates from the original spec sketch, deliberately:

- **`p_user_id` is gone.** The owner comes from `auth.uid()`. Accepting a user id
  from the caller would let anyone book in someone else's name.
- **`p_seat_ids` is folded into `p_passengers`**, each carrying its own `seatId`.
  Two parallel arrays can disagree about length or order; one array cannot.

Inside, the ordering is the entire point: **lock first, then check.** A
concurrent caller wanting any of the same seats blocks on the `FOR UPDATE`; when
it proceeds, READ COMMITTED gives it a fresh snapshot in which those seats are
`HELD`, so its availability check fails. Checking before locking would let both
callers read `AVAILABLE` and both proceed.

The lock is taken `ORDER BY seat_id`. Without a deterministic order, two callers
requesting overlapping seat sets in opposite orders each hold one row and wait on
the other's — a deadlock Postgres resolves by killing one with an error the
client cannot interpret.

Prices are computed from the trip's own `fare`. Nothing about the amount comes
from the caller.

Errors are raised with the message set to an exact code from
`src/constants/errors.ts`; `mapRpcError` in `src/services/booking-service.ts`
turns them back into a typed `AppError`.

### `expire_seat_holds()`

Granted to `service_role` only. Expiry must not depend on a client timer, which
stops the moment the app is backgrounded.

### The `trip_search` view

Search needs a trip plus operator, both terminals, the bus, and a live bookable-seat
count. The view is declared `with (security_invoker = true)` so it runs with the
**caller's** privileges — without that, a view becomes a way around RLS.

### Verifying

```bash
pnpm db:verify:all
```

`scripts/verify-booking.mjs` adds 38 checks to the 31 RLS ones, including the one
guarantee that cannot be unit-tested: eight simultaneous callers race for a
single seat and exactly one wins. It also covers overlapping-set deadlock
resistance, expired-hold reclaim, idempotent cancellation, and that a client
cannot confirm its own booking. It cleans up after itself, so it is re-runnable.
