/**
 * Service layer.
 *
 * Screens never talk to Supabase directly. Each service owns the queries,
 * mutations and Edge Function calls for one domain, and TanStack Query hooks in
 * `src/hooks/` wrap them for the UI.
 *
 * Services are added by the phase that owns them, rather than up front as empty
 * files, so their signatures are designed against a real schema instead of
 * guessed:
 *
 *   authService          Phase 2   sign in/up/out, password reset, profile
 *   tripService          Phase 4   terminals, routes, trip search, trip detail
 *   bookingService       Phase 4   reserve_seats RPC, create/cancel booking
 *   paymentService       Phase 5   provider-agnostic payment create/get/confirm/refund
 *   qrService            Phase 6   booking QR payloads, validate-qr, confirm-boarding
 *   trackingService      Phase 8   driver location publishing, passenger subscription
 *   walletService        Phase 9   balance, mock top-up, transactions
 *   loyaltyService       Phase 10  points, rewards, redemptions
 *   sosService           Phase 11  trigger/acknowledge/resolve incidents
 *   notificationService  Phase 12  feed, read state, push registration
 *
 * Two rules hold for every one of them: privileged operations go through Edge
 * Functions rather than table writes, and no service ever decides a price, a
 * payment status, a booking status, or a points balance on the client.
 */

export {};
