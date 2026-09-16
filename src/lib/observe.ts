/**
 * EAS Observe configuration.
 *
 * Imported for its side effect by `src/app/_layout.tsx`, at module scope and
 * before anything else in the tree. That placement is load-bearing:
 * `useObserve()` asserts that the router integration is not toggled during a
 * screen's lifecycle, so `configure` has to run before the first screen mounts,
 * not inside an effect.
 *
 * Nothing here contradicts the "root layout stays light" rule in AGENTS.md.
 * Observe is not an auth gate and not a native permission provider — it asks
 * the user for nothing, and `expo-observe` ships a web shim whose `configure`
 * and `dispatchEvents` are no-ops, so the public `/payment/[reference]` page
 * still renders in a logged-out browser.
 *
 * Metrics are dispatched only from release builds (`dispatchInDebug` defaults
 * to false), so a `pnpm web` or dev-client session records nothing.
 */

import { Observe } from 'expo-observe';

/**
 * Route and query parameters stripped from exported navigation metrics.
 *
 * Every one of these is an identifier for a real booking, payment or person,
 * and none of them tells us anything about performance — `/payment/[reference]`
 * is the useful unit, `PAY-2026-000001` is just a passenger's receipt number
 * sitting in a third party's dashboard.
 *
 * `reference` is the sharpest of them: it is the value inside every payment QR
 * code, and `/payment/[reference]` is a **public** page that needs no session.
 * A reference that leaked would let the finder open somebody's payment page.
 *
 * Filtering a parameter also replaces the exported URL with `urlHidden: true`,
 * which is the intended trade — `routeName` is unaffected, so the route pattern
 * still arrives and remains groupable. Keep this list in step with the dynamic
 * segments under `src/app/` and the `params` passed to `router.push`.
 */
const SENSITIVE_PARAMS = [
  'reference', // payment/[reference] — public page, value lives in the QR code
  'id', // bookings/[id]
  'bookingId',
  'paymentId',
  'tripId',
  'operator',
];

Observe.configure({
  integrations: {
    // Records cold_ttr, warm_ttr and tti per route from expo-router's own state
    // changes. Off by default; this app is entirely expo-router, so it is the
    // whole point of installing Observe here.
    'expo-router': {
      filteredParams: SENSITIVE_PARAMS,
    },
  },
});
