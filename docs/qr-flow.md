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

## Status: built

The payment QR (Phase 5), the boarding QR, the scanner and validation (Phase 6) all work, and the
scanner runs in a browser as well as on a phone. `pnpm db:verify:boarding` checks this document's
claims against the real Edge Functions.

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

**A scan is always made at a door.** The scanner is opened from a specific trip — the one being
boarded — and `validate-qr` requires that trip's id. It is not optional: a ticket means nothing
except against a particular bus, so a scan with no trip is a `VALIDATION_ERROR`, not a guess.

`validate_booking_qr` and `confirm_boarding` reach their verdict through the same
`boarding_verdict` function, so what the screen shows and what the server will actually board can
never disagree. It asks, in this order:

1. **The door.** The trip must be `BOARDING` — `BOARDING_NOT_OPEN` before that, `BOARDING_CLOSED`
   once it has departed or been cancelled.
2. **The right bus.** If the ticket is for another trip, the most useful reason is returned:
   `WRONG_ROUTE`, `WRONG_DATE` (a different day), `WRONG_BUS` (another departure of the same route
   that day), or a bare `WRONG_TRIP` for another operator's ticket.
3. **The ticket.** `BOOKING_CANCELLED` for a cancelled or refunded booking, `ALREADY_BOARDED` once
   every passenger on it is aboard, `UNPAID_BOOKING` without a `PAID` payment, otherwise `VALID`.

`INVALID_QR` and `QR_EXPIRED` come from the Edge Function, before any of this: the signature is
checked first, and only in its canonical spelling — the same bytes written a different way are
refused.

**How much a refusal reveals is deliberate.** For another operator's ticket only the verdict comes
back — no reference, no trip, no passengers. For a ticket on another of *this* operator's trips the
trip is described, so the passenger can be sent to the right bus, but the passenger list is not.

Every scan, including every refusal, writes a `qr_scans` row with the trip being boarded, its bus,
the scanner, and how the ticket was presented (`QR`, `REFERENCE`, `MANUAL`).

## Boarding

Only after a `VALID` result does the operator see passenger details and a **Board** action, which
calls `confirm-boarding`. The server advances `CONFIRMED → CHECKED_IN → BOARDED` and writes a
`qr_scans` row (`scan_type` `VALIDATION` or `BOARDING`).

**Boarding is per passenger.** One booking can carry a family, and one of them can be late, so
`booking_passengers` carries its own `boarded_at` and `boarded_by`. The scanner ticks everyone
waiting by default; untick whoever is not there and they can board on a later scan. The booking
turns `BOARDED` as soon as anyone on it boards, and only reports `ALREADY_BOARDED` once nobody is
left. The manifest and the boarded counts read the per-passenger field, so "3 of 4 boarded" is the
truth rather than a rounding of it.

When every waiting passenger is ticked the app sends no passenger ids at all, and the server boards
"everyone not yet aboard" — which quietly absorbs someone boarded at another door in between.

**A refusal is a result, not an error.** `confirm-boarding` returns `boarded: false` with the
verdict rather than throwing, because a refused boarding is exactly the thing worth having a record
of. (An earlier version wrote the scan row and then raised, which rolled the row back.)

The scanner never marks boarding locally. Offline, it says the ticket cannot be verified rather than
letting a passenger through on unverified state.

## Scanning in a browser

The same `BoardingScanner` scans on web — a ticket-counter laptop or a tablet browser works, not only
the native app. expo-camera decodes QR codes in the browser with the native `BarcodeDetector` API
where it exists (Chrome and Edge on Android, macOS and ChromeOS) and otherwise with a WebAssembly
build of ZXing (Windows and Linux desktop Chrome, Firefox, Safari). The decoder is a separate 45 KB
chunk loaded only when the scanner opens, and it samples the camera about three times a second.

A boarding pass is a version-14 QR (73×73 modules, ECL M). The WebAssembly decoder reads one reliably
even when the code is only ~140 px wide in a 640×480 frame, so a webcam at arm's length is enough.

**Two conditions are outside the app's control:**

- **The page must be HTTPS** (or `localhost`). On plain HTTP — say, a LAN address like
  `http://192.168.1.20:8090` — browsers remove the camera API entirely. The Vercel deployment is
  HTTPS; a dev server reached over the LAN is not.
- **The WebAssembly decoder is downloaded from `fastly.jsdelivr.net`** the first time a browser
  without `BarcodeDetector` opens the scanner. If that host is blocked on the terminal's network,
  scanning fails on those browsers and manual entry still works. Serving the `.wasm` from our own
  origin is possible (`barcode-detector` exposes `prepareZXingModule`) but not done: the binary must
  match the decoder's JavaScript exactly, so it would have to be copied from `node_modules` on every
  build rather than committed. A Content-Security-Policy added later must allow that host in
  `connect-src` and permit `'wasm-unsafe-eval'`.

expo-camera's web permission API reports every failure — no camera, insecure page, camera held by
another app — as `DENIED`, and always claims it can ask again. `src/lib/web-camera.ts` detects the
real cause first, so the operator is told what to fix instead of being shown an "Allow" button that
cannot work. Manual entry is always available as the fallback.
