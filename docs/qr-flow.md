# QR flow

PalaGo uses **two** QR codes with deliberately different jobs. Confusing them would let an unpaid
booking board.

| | Payment QR | Boarding QR |
|---|---|---|
| Created | when the mock payment is created | only *after* payment is confirmed |
| Contains | payment URL + reference | booking id, reference, signed token |
| Purpose | opens the test payment web page | the passenger's actual ticket |
| Validated by | nothing — it is just a link | `validate-qr` Edge Function, server-side |
| Reusable | yes, until the payment expires | no — one boarding per booking |

## Status: not yet implemented

Phase 5 builds the payment QR; Phase 6 builds the boarding QR, the scanner, and validation.

## Boarding QR payload

```json
{
  "type": "PALAGO_BOOKING",
  "bookingId": "…",
  "reference": "PG-2026-000001",
  "token": "SIGNED_TOKEN"
}
```

Nothing else goes in. No passenger name, no seat, no phone number, no payment detail — a QR on a
screen is readable by anyone standing nearby. The token is signed with a secret held only in
Supabase Edge Function secrets and is verified server-side on every scan.

## Validation

The operator scanner (expo-camera) parses the payload and calls `validate-qr`, which checks that:
the token is valid; the booking exists; the booking belongs to *this* trip; the payment is `PAID`;
the booking is `CONFIRMED`; it is not cancelled or refunded; it has not already boarded; the trip is
valid; and the QR has not expired.

Results the scanner must handle explicitly: `VALID`, `INVALID_QR`, `QR_EXPIRED`, `UNPAID_BOOKING`,
`WRONG_TRIP`, `ALREADY_BOARDED`, and cancelled/refunded bookings. Codes come from
`src/constants/errors.ts`.

## Boarding

Only after a `VALID` result does the operator see passenger details and a **Confirm boarding**
action, which calls `confirm-boarding`. The server advances `CONFIRMED → CHECKED_IN → BOARDED` and
writes a `qr_scans` row (`scan_type` `VALIDATION` or `BOARDING`).

The scanner never marks boarding locally. Offline, it says the ticket cannot be verified rather than
letting a passenger through on unverified state.
