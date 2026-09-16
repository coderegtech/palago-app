# Testing

```bash
pnpm check
```

`typecheck` → `lint` → `test`, in sequence. The gate every phase must pass before the next starts.

```bash
pnpm db:verify:all
```

Sixteen suites, **802 checks**, against a live local database. Required after any migration.

```bash
pnpm test:coverage
```

---

## The shape of it

PalaGo is tested at three levels, and the split is deliberate rather than accidental. Most of what
this app promises cannot be proven by a unit test, because most of what it promises is enforced by
Postgres.

| Level | Count | What only this level can prove |
|---|---|---|
| **Unit** — Jest + RNTL | 175 tests, 19 suites | Pure logic, error mapping, validation, and the *contract a service asks the database for* |
| **Database** — `verify-*.mjs` | 802 checks, 16 suites | RLS, concurrency, idempotency, authorisation. Each signs in as a real seeded role through the ordinary publishable key |
| **Browser** — `pnpm web`, `pnpm docs:screens` | 36 captured screens | That routes resolve, NativeWind produces the expected computed styles, and `/payment/[reference]` renders logged-out |

**Unit coverage is 9% of `src/`, and that number is not the one to watch.** Most of `src/` is
screens. The layers where a silent bug is expensive are covered: `utils` 97%, `schemas` 100%,
`constants` 100%, `lib` 69%. `services` and `hooks` sit in single digits because their real
guarantees — that a rival operator cannot read your manifest, that eight callers racing for one seat
produce one booking — live in the database, and a mocked Supabase client can only prove that a mock
was called.

`jest.config.js` therefore sets thresholds **only where coverage is real**, a few points below where
it stands, as a ratchet against regression. There is no global threshold, because one low enough to
pass would guarantee nothing while looking like it did.

---

## Setup

- **Runner**: Jest with the `jest-expo` preset (`jest.config.js`).
- **Component tests**: React Native Testing Library 14 — **`render` is async** and interactions go
  through `userEvent`:

  ```tsx
  const user = userEvent.setup();
  await render(<Button label="Continue" onPress={onPress} />);
  await user.press(screen.getByRole('button', { name: 'Continue' }));
  ```

  It needs the `test-renderer` package, which replaces the deprecated `react-test-renderer`.
- **Environment**: `jest.setup.js` supplies deterministic `EXPO_PUBLIC_*` values, so importing
  `@/lib/env` never depends on the developer's local stack.
- **AsyncStorage is mocked globally** in `jest.setup.js`, using the mock the package ships. This is
  load-bearing: `@/lib/supabase` reaches for AsyncStorage at module scope, so *anything* importing a
  service used to fail at import with "native module not available". That is most of why `services`
  and `hooks` had near-zero coverage — not that the tests were hard to write, but that they could
  not run at all.
- **Path aliases**: `@/…` mapped in `jest.config.js`, matching `tsconfig.json`.

### Testing a service without a database

Services own Supabase access, so a unit test asserts **what was asked for**, not what came back. The
filters *are* the behaviour — they execute in Postgres, so there is nothing else to observe. The
chainable-builder mock in `src/services/__tests__/trip-service.test.ts` is the pattern: every method
returns the builder, the two that end a chain (`order`, `single`) resolve, and the test inspects the
recorded calls.

---

## Where each scenario is actually tested

The full list from the original plan, mapped honestly. **Bold** are the concurrency and idempotency
guarantees that a passing happy-path test says nothing about.

| Scenario | Unit | Database | Browser |
|---|---|---|---|
| Registration, login, logout | `auth-service`, `schemas/auth` | `verify-rls` | walkthrough 01 |
| Role → home routing | `auth-gate` | — | walkthrough |
| Trip search and filtering | `trip-service` | `verify-booking` | walkthrough 03–04 |
| Inactive bus/route/operator hidden from search | `trip-service` | `verify-schedules` | — |
| Seat selection | — | `verify-booking` | walkthrough 05 |
| **Concurrent seat reservation** | — | `verify-booking` — 8 simultaneous buyers, one seat | — |
| Booking creation | `schemas/booking`, `booking-store` | `verify-booking` | walkthrough 06 |
| Payment creation, QR, web page | — | `verify-payment` | walkthrough 07 |
| **Duplicate payment confirmation** | — | `verify-payment` — confirmed 5×, one receipt | — |
| Receipt uniqueness | — | `verify-payment` | — |
| Realtime payment status | — | `verify-notifications` | — |
| Boarding QR generation and validation | `boarding-door` | `verify-boarding` | walkthrough 09 |
| Invalid / expired / forged QR | — | `verify-boarding` — unsigned, tampered, re-spelled, rewritten-around-the-signature, wrong type, non-PalaGo | — |
| **Duplicate boarding** | — | `verify-boarding` — 6 simultaneous scans, one boards | — |
| Unpaid and wrong-trip boarding | `boarding-door` | `verify-boarding` | — |
| Trip tracking, GPS permission denial | `web-camera` | `verify-tracking` | walkthrough 12 |
| Loyalty award and redemption | — | `verify-loyalty` — redeem/undo must not inflate | walkthrough 11 |
| Wallet top-up and payment | — | `verify-wallet` — 8 concurrent top-ups | walkthrough 10 |
| SOS | — | `verify-sos` — a second press raises no second alert | walkthrough 13 |
| Notifications | — | `verify-notifications` | walkthrough 15 |
| Cancellation and refund | — | `verify-payment`, `verify-schedules` | — |
| Schedule conflicts | `schedule-service`, `utils/schedule` | `verify-schedules` — two Saves at one instant | walkthrough 22 |
| Staff provisioning, two-status model | `table`, `datetime` | `verify-staff-accounts` | walkthrough 23–24, 32–33 |
| **RLS and unauthorised access** | — | `verify-rls`, `verify-security` | — |
| Write scope — no client writes past the RPCs | — | `verify-security` — 26 checks | — |

### Not covered anywhere

Stated plainly rather than left to be discovered:

- **Push delivery to a handset.** Needs a device and a development build.
- **MapLibre on hardware.** It typechecks against the real v11 API; it has never rendered.
- **The camera.** `web-camera.ts` covers the web fallback logic; the native scanner is unexercised.
- **`hooks/`** — 0.5%. TanStack Query wrappers, mostly thin; the services beneath them and the
  database beneath those are covered.
- **Screens** — no component tests beyond `Button` and `boarding-trip-picker`. Verified in a browser.

---

## Rules that make a test worth having

- **A test that has never failed proves nothing.** Every check added in Phases 13 and 14 was run
  against the broken code first. `verify-security` failed 5 of 26 against the schema as it was;
  `trip-service` failed 2 of 9 before the search filter existed.
- **Assert the effect, not the error message.** A revoked grant answers `42501`; RLS with no matching
  policy answers no error at all and silently changes nothing. Both are a pass — what must never
  happen is rows moving. Checking only the message would have passed a `create_bus` that let any
  passenger add a bus to any fleet.
- **A check that skips itself is worse than no check.** `verify-security`'s UNAVAILABLE-driver case
  looked for a driver the seed does not have, silently skipped, and reported 21 passes where there
  were 22. It now stands a driver down itself and puts them back.
- **Suites are meaningful straight after `pnpm db:reset`.** Tracking and loyalty consume seed state.
  Reset, then run once.
- **Don't hardcode a seeded trip number.** They embed the date they were generated for
  (`CHERRY-0912-B`), so a test that names one passes the day it is written. Pick trips by
  relationship.
- **If a security check fails intermittently, find the mechanism.** An occasional "a tampered
  signature is invalid" failure was blamed on a cold Edge container; the real cause was the test
  flipping the signature's final base64 character, whose low bits are padding — one run in sixteen
  the tampered copy decoded to the same bytes.

## Running one suite

```bash
pnpm db:verify:security
```

Also: `booking`, `payment`, `boarding`, `operator`, `tracking`, `wallet`, `loyalty`, `sos`,
`discount`, `counter`, `notifications`, `staff`, `schedules`, `admin`.

`pnpm db:verify:all` needs `pnpm functions:serve` running — and **exactly one copy**. Two
`supabase functions serve` processes fight over the edge-runtime container and take it down, which
surfaces as `503 name resolution failed` and looks like a broken function.
