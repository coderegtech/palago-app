# Testing

```bash
pnpm test
```

```bash
pnpm check
```

`check` runs typecheck, lint and tests in sequence — the gate every phase must pass before the next
one starts.

## Setup

- **Runner**: Jest with the `jest-expo` preset (`jest.config.js`).
- **Component tests**: React Native Testing Library 14. Note that in v14 **`render` is async** and
  interactions go through `userEvent`:

  ```tsx
  const user = userEvent.setup();
  await render(<Button label="Continue" onPress={onPress} />);
  await user.press(screen.getByRole('button', { name: 'Continue' }));
  ```

  It also requires the `test-renderer` package, which replaces the deprecated
  `react-test-renderer`.
- **Environment**: `jest.setup.js` supplies deterministic `EXPO_PUBLIC_*` values so importing
  `@/lib/env` in a test never depends on the developer's local Supabase instance.
- **Path aliases**: `@/…` is mapped in `jest.config.js`, matching `tsconfig.json`.

## Current coverage (Phases 1-2)

| Suite | What it protects |
|---|---|
| `src/utils/__tests__/money.test.ts` | Centavo arithmetic, rounding, peso formatting |
| `src/utils/__tests__/cn.test.ts` | A caller's `className` can override a component default |
| `src/lib/__tests__/env.test.ts` | Config validation, including the guard rejecting any non-mock payment provider |
| `src/lib/__tests__/errors.test.ts` | Auth/PostgREST/network errors map to our own codes; credential wording stays vague |
| `src/components/ui/__tests__/button.test.tsx` | Button behaviour, disabled/loading states, and NativeWind rendering end to end |
| `src/schemas/__tests__/auth.test.ts` | Email/password/PH-mobile validation, password confirmation, and that `profileSchema` has no `role` field |
| `src/services/__tests__/auth-service.test.ts` | Sign-up sends no role; sign-in raises rather than returning a null session; profile updates write only grantable columns |

57 tests.

Database-level guarantees — RLS isolation and the role-escalation defences — are **not** covered by
these unit tests. They were verified by probing the live local stack (see
[security.md](security.md)); Phase 13 should turn that probe into an automated suite so a policy
change cannot silently weaken them.

## What later phases must test

Registration · login · logout · trip search and filtering · seat selection · **concurrent seat
reservation** · booking creation · payment creation · payment QR generation · the payment web page ·
test payment confirmation · **duplicate** payment confirmation · receipt generation and uniqueness ·
Realtime payment status · boarding QR generation · QR validation · invalid QR · expired QR ·
**duplicate boarding** · unpaid boarding · wrong-trip boarding · trip tracking · GPS permission
denial · loyalty award and reward redemption · SOS · notifications · booking cancellation · mock
refund · RLS authorisation and unauthorised access.

The bolded ones are the tests that matter most: they are the concurrency and idempotency guarantees
that a passing happy-path test says nothing about.

## Payment scenarios (Phase 5)

1. Create booking → `PAYMENT_PENDING`
2. Create payment → `PENDING`
3. Generate payment QR → valid payment URL
4. Scan QR → the web payment page opens
5. Confirm test payment → payment `PAID`, booking `CONFIRMED`, receipt created
6. Confirm again → **no** duplicate receipt
7. Scan boarding QR → `VALID TICKET`
8. Board passenger → `BOOKED → BOARDED`
9. Scan again → `ALREADY_BOARDED`
10. Board an unpaid booking → `UNPAID_BOOKING`

## Manual verification

Browser-driven checks against `pnpm web` verify what unit tests cannot: that routes resolve, that
NativeWind classes produce the expected computed styles, and that `/payment/[reference]` renders in
a logged-out browser. Requesting the Android bundle from Metro
(`/node_modules/expo-router/entry.bundle?platform=android&…`) compiles the native bundle without a
device, which is how a NativeWind or native-module regression is caught early.
