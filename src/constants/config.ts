/**
 * Business rules that later phases depend on. Values here are the *client's*
 * view of the rule; the server always re-checks them independently. Nothing in
 * this file is ever the deciding authority for money, seats, or booking state.
 */

/** Seat hold / payment window, in minutes. Mirrored by the server. */
export const SEAT_HOLD_MINUTES = 10;

export const CURRENCY = 'PHP' as const;
export const CURRENCY_SYMBOL = '₱';

/** Reference prefixes. The server generates the sequence numbers. */
export const REFERENCE_PREFIX = {
  BOOKING: 'PG',
  PAYMENT: 'PAY',
  RECEIPT: 'RCP',
} as const;

/** Payload discriminator for the boarding QR. See docs/qr-flow.md. */
export const QR_BOOKING_TYPE = 'PALAGO_BOOKING' as const;

export const MAX_PASSENGERS_PER_BOOKING = 10;

/** Driver GPS ping interval, in milliseconds (Phase 8). */
export const LOCATION_UPDATE_INTERVAL_MS = 10_000;

/**
 * Displayed wherever mock money appears. PalaGo never charges real money in
 * this build — see the payment section of README.md.
 */
export const TEST_MODE_LABEL = 'TEST TRANSACTION';
export const TEST_PAYMENT_WARNING = 'No real money will be charged.';
