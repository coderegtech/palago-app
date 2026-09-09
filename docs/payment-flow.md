# Payment flow

> **PalaGo processes no real money.** The only implemented provider is `MockPaymentProvider`.
> Stripe, GCash, Maya, card processing and bank APIs are intentionally not connected. Every amount,
> receipt and revenue figure in this system is test data.

The mock provider is *not* a shortcut around the backend. It runs the complete real flow — database
records, server-side validation, Edge Functions, receipts, Realtime — and only the act of moving
money is simulated. That is what makes swapping in a real provider a contained change.

## Status: not yet implemented

Phase 5 builds this. This document records the design the rest of the system is being built
against; nothing described below exists in code yet beyond the route shell at
`src/app/payment/[reference].tsx`.

## End-to-end flow

```
User selects trip → seats → passengers
        ↓
create-booking            booking = PAYMENT_PENDING, seats = HELD (10 min)
        ↓
create-test-payment       payment = PENDING, reference PAY-2026-000001, payment URL
        ↓
app renders payment QR    QR encodes only the payment URL + reference
        ↓
user scans with any phone → opens /payment/PAY-2026-000001 in a browser
        ↓
get-payment               returns a SAFE summary (no private fields)
        ↓
page shows the booking and the amount due
        ↓
CONFIRM PAYMENT → confirm-test-payment (Edge Function, never a direct table write)
        ↓
payment = PAID · receipt RCP-2026-000001 · booking = CONFIRMED · seats confirmed
        ↓
audit log + notification + Realtime update
        ↓
mobile app shows "Booking confirmed" and only NOW generates the boarding QR
```

The payment QR and the boarding QR are **different QRs with different jobs**. The payment QR opens a
web page and is worthless as a ticket. The boarding QR is the ticket and is generated only after
payment is confirmed. See [qr-flow.md](qr-flow.md).

## `confirm-test-payment` contract

The function must, in one transaction, verify that: the payment reference is valid; the payment
exists and is `PENDING`; the booking exists and is `PAYMENT_PENDING`; the payment amount equals the
booking total *as recomputed by the server*; the booking has not expired; and the booking is not
cancelled. Only then does it mark the payment `PAID`, generate the receipt, confirm the booking,
confirm the trip seats, set `paid_at` / `confirmed_at`, write a payment transaction, write an audit
log, and create a notification.

**Idempotency is mandatory.** Calling it five times must produce one payment, one receipt, and one
booking confirmation. This is enforced by a unique constraint on `receipts.receipt_number` plus a
status precondition, not by client-side de-duplication — a retried request after a dropped
connection is normal on a Palawan mobile network.

## Expiry

Seat holds and payments expire after 10 minutes (`SEAT_HOLD_MINUTES`). On expiry: payment
`PENDING → CANCELLED`, booking `PAYMENT_PENDING → CANCELLED`, trip seats `HELD → AVAILABLE`. This is
driven by `expire-seat-holds` and/or a scheduled database job — never by a client timer, which stops
running the moment the app is backgrounded.

## Adding a real provider later

The system depends on the `PaymentProvider` interface, not on the mock:

```ts
interface PaymentProvider {
  createPayment(input): Promise<Payment>;
  getPayment(reference): Promise<Payment>;
  confirmPayment(reference, evidence): Promise<Payment>;
  refundPayment(reference, amount): Promise<Refund>;
}
```

To add Stripe, GCash or Maya:

1. Implement the interface in a new Edge Function module (`StripePaymentProvider`, …).
2. Register it against the `PaymentProvider` enum value already declared in `src/constants/enums.ts`.
3. Point `EXPO_PUBLIC_PAYMENT_PROVIDER` at it and add the provider's secret to Supabase secrets.
4. Replace the "confirm" step: a real provider confirms via a signed **webhook** from the provider,
   not a button. The rest of `confirm-test-payment`'s work — receipt, booking confirmation, seat
   confirmation, audit, notification — is reused unchanged.

Nothing in the booking funnel, seat reservation, receipts, QR, or operator scanning changes.

Note that `src/lib/env.ts` currently *rejects* any provider other than `mock`. That guard is
deliberate and should only be relaxed as part of deliberately adding a real provider.

## Paying from the mock wallet (Phase 9)

A second way to pay, added in Phase 9 and deliberately landing in the same place as the first.

`pay_booking_with_wallet(booking_id)` is SECURITY DEFINER and repeats every precondition
`confirm_test_payment` applies: the booking must be the caller's, PAYMENT_PENDING and unexpired, and
the amount is **re-derived from the booking** — the request carries a booking id and nothing else, so
there is no shape in which a client names a price.

It then does what the QR path does: inserts a PAID `payments` row (provider MOCK), issues a receipt
with `payment_method = 'PalaGo Wallet'`, debits the wallet through the ledger, moves the booking to
CONFIRMED and the seats to BOOKED, and writes the payment transaction, audit entry and notification.
Downstream — the boarding pass, the operator manifest, the revenue totals — cannot tell the two
apart, and must not: a passenger who paid is a passenger who paid.

Any PENDING QR payment for the booking is cancelled first, so one booking is never paid twice.

Refunds return to the wallet when the ledger shows the payment came from one. That is recognised by
the presence of a `BOOKING_PAYMENT` ledger row for the payment, not by a flag, so there is a single
source of truth; the partial unique index on `(payment_id, type)` makes the credit-back idempotent.

Every centavo remains test money. `payments.provider` is still constrained to MOCK.

## A note on the removed test notices

The UI used to carry TEST PAYMENT / TEST DATA / TEST RECEIPT banners on every screen that showed a
peso figure, and the database stored matching wording (`payment_method = 'TEST PAYMENT'`, a wallet
ledger description of "Test top-up - no real money received", notification titles like "Test payment
confirmed"). All of that was removed on request in favour of neutral wording.

**Nothing about the payment system changed.** `payments.provider` is still constrained to `MOCK` by
`payments_mock_only`, and `src/lib/env.ts` still refuses to start with any other provider. No money
moves and none can.

What did change is that a receipt or a balance from this build is now visually indistinguishable
from a real one. If a real provider is ever added, the switch has to be a deliberate decision — the
on-screen labels are no longer there to make the mock obvious to whoever is looking at it.
