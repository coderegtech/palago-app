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

/** Driver GPS ping interval, in milliseconds. */
export const LOCATION_UPDATE_INTERVAL_MS = 10_000;

/**
 * Minimum metres moved before a fix is published, on top of the interval.
 * A bus queueing at a terminal should not spend battery re-sending the same
 * coordinate every ten seconds.
 */
export const LOCATION_DISTANCE_INTERVAL_M = 25;

/**
 * A position older than this is shown as last-known with its age, not as the
 * bus's current spot. Six intervals: long enough to ride out a tunnel or a
 * dropped packet, short enough that a passenger is not misled about where the
 * bus is. A frozen marker with no explanation is worse than no marker.
 */
export const LOCATION_STALE_AFTER_MS = LOCATION_UPDATE_INTERVAL_MS * 6;

/**
 * A departure within this many minutes of schedule counts as on time.
 * Mirrored by `v_grace` in `operator_dashboard` — the server is the authority;
 * this constant only labels what the server already computed.
 */
export const ON_TIME_GRACE_MINUTES = 15;

/**
 * Wallet bounds, in centavos. Mirrored by `wallet_max_top_up()` and
 * `wallet_max_balance()` in the database, which are the authority — these only
 * let the UI refuse an obviously-too-large amount before a round trip.
 */
export const WALLET_MAX_TOP_UP = 1_000_000; // ₱10,000.00
export const WALLET_MAX_BALANCE = 5_000_000; // ₱50,000.00

/** Offered as one-tap amounts on the top-up sheet. */
export const WALLET_TOP_UP_PRESETS = [50_000, 100_000, 200_000, 500_000] as const;

/**
 * Centavos that earn one loyalty point: ₱10.00. Mirrored by
 * `loyalty_points_for()` in the database, which is the authority — points are
 * awarded server-side when a trip completes, never computed by the client.
 */
export const LOYALTY_CENTAVOS_PER_POINT = 1_000;

/*
 * The TEST_MODE_LABEL / TEST_PAYMENT_WARNING strings were removed when the
 * test-mode banners were taken out of the UI.
 *
 * Nothing about the payment system itself changed: `payments.provider` is still
 * constrained to MOCK by the database, and `src/lib/env.ts` still refuses any
 * other provider. The build charges nothing real — it just no longer says so on
 * screen. Restoring the notices means reinstating these two strings and the
 * `<Alert>` blocks that used them.
 */
