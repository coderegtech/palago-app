# Security

Security is built in from Phase 1, not retrofitted. The rules below constrain every later phase.

## Trust boundary

The mobile and web app hold **only** the Supabase publishable (anon) key. Everything reachable with
it is bounded by Row Level Security. Service-role keys, QR signing secrets and provider credentials
live in Supabase Edge Function secrets and must never appear in `.env` (which is inlined into the
bundle), in the repository, or in any `EXPO_PUBLIC_*` variable.

`.gitignore` excludes `.env` and `.env.*` while keeping `.env.example`.

## What the client may never do

These are enforced by RLS and by routing the operation through an Edge Function — not by hiding a
button:

| Forbidden | Enforced by |
|---|---|
| `UPDATE payments SET status = 'PAID'` | No client UPDATE policy on `payments`; only `confirm-test-payment` |
| `UPDATE bookings SET status = 'CONFIRMED'` | No client UPDATE policy for status transitions |
| Setting its own price, discount or total | Server recomputes and compares before accepting payment |
| Adding loyalty points | Points are written only by server functions, after a completed booking |
| Marking itself boarded | `confirm-boarding`, callable only by an authorised operator |
| Posting GPS for a bus it is not driving | RLS ties `bus_locations` inserts to the assigned driver |
| **Setting its own role** | Column grant on `profiles.role` withheld from `authenticated`; the sign-up trigger ignores any role in user metadata — see [auth.md](auth.md) |

### Verified

The `profiles` defences were probed against the live local stack, not assumed. A signed-in user:
reads exactly one row (their own); cannot read or edit another user's row; cannot insert; and is
refused with `permission denied` when updating their own `role`. An anonymous client reads nothing.
A sign-up that passes `role: 'ADMIN'` in metadata produces a `USER`.

Re-run these as part of the Phase 13 review, and again whenever a `profiles` policy changes.

## Row Level Security

RLS is enabled on every user-facing table. It is never disabled to make frontend work easier — a
policy that is inconvenient during development is a policy that is about to be shipped broken.

- **User** — own profile, wallet, bookings, passengers, payments, receipts, loyalty, notifications,
  SOS incidents. Bus location only for a trip they hold a confirmed booking on.
- **Operator** — their own operator's buses, trips, crew, manifests, scans, trip locations, and SOS
  incidents raised on their trips.
- **Driver** — assigned trips and their passengers; may write location only for the trip assigned to
  them.
- **Assistant** — assigned operational data.
- **Admin** — full access.

Frontend role checks (the `(user)` / `(operator)` layouts) are for navigation, not authorisation.

## QR security

The boarding QR carries an ID, a human-readable reference, and a server-signed token — nothing else.
No passenger names, no seat numbers, no contact details, no payment data: anything in a QR is
readable by anyone who photographs the screen. Tokens are verified server-side by `validate-qr`;
a QR that has not been validated by the server is not a ticket.

Duplicate-scan protection is a server-side state machine (`CONFIRMED → CHECKED_IN → BOARDED`), so a
second scan of the same booking returns `ALREADY_BOARDED` regardless of which operator device scans
it.

## Offline behaviour

Critical actions require server confirmation. The app must never show a booking as confirmed, a
payment as paid, or a passenger as boarded based on local state alone. When the operator scanner is
offline it says so — "Unable to verify ticket. Internet connection required." — rather than guessing.

## Idempotency

Booking creation, payment creation, payment confirmation, receipt generation, boarding, loyalty
awards and SOS creation are all idempotent. On a flaky network the client will retry; the server is
what guarantees that a retry does not create a second receipt.

## Audit logging

Login, booking created, payment created, test payment confirmed, receipt generated, booking
cancelled, QR scanned, boarding confirmed, SOS created/acknowledged/resolved, role changes and
operator changes are all recorded in `audit_logs`.

## Attack surface checklist

Worked through in the Phase 13 review — **[security-review.md](security-review.md)**, which found
and closed four write paths: an operator could hard-delete a trip, could roster a rival operator's
driver by writing `trip_assignments` directly, could thereby skip every validation in
`assign_trip_crew`, and could rename a seat out from under a sold ticket.

All four were the same mistake — a `FOR ALL` policy outliving the feature that needed it — so the
rule is now: **a privileged operation is only as narrow as its narrowest path.** When a function
becomes the front door, close the back door in the same migration, and say so in the policy rather
than relying on a grant nobody can see.

The list itself: double booking, duplicate payment confirmation, duplicate boarding, forged QR,
cancelled-ticket scanning, unpaid-ticket scanning, expired payment, expired seat hold,
unauthorised operator access, unauthorised location access, unauthorised SOS access. Each has
checks in the verify suites that were run against violating data before being trusted.

`pnpm db:verify:security` guards the review's findings; it failed five of its checks against the
schema as it was.
