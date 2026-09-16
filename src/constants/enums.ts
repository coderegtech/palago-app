/**
 * Domain enumerations.
 *
 * Every status in PalaGo lives here as a `const` object plus a derived union
 * type. Phase 3 mirrors these exactly as PostgreSQL enums, so the database and
 * the client can never drift apart. Never inline these strings at a call site.
 */

/**
 * Who someone is, and therefore what the server will let them do.
 *
 * The names say what each role is responsible for:
 *
 *   SUPER_ADMIN    runs the platform. Creates and manages the operators, sees
 *                  every company's data, and deliberately does NOT schedule
 *                  departures or roster crew — that is operational work and it
 *                  belongs to the company doing the operating.
 *   OPERATOR_ADMIN runs one bus company: its buses, its drivers, its crew, its
 *                  schedules, its reservations. Never another company's.
 *   DRIVER / CREW  ride the bus. They see their own roster and set their own
 *                  availability; they manage nobody.
 *   USER           a passenger.
 *
 * These are navigation and display only. Authorisation is the database's —
 * every one of these names appears in RLS policies and SECURITY DEFINER
 * functions, which is what actually decides. See docs/management.md.
 */
export const UserRole = {
  USER: 'USER',
  OPERATOR_ADMIN: 'OPERATOR_ADMIN',
  DRIVER: 'DRIVER',
  CREW: 'CREW',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const OperatorStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type OperatorStatus = (typeof OperatorStatus)[keyof typeof OperatorStatus];

export const BusType = {
  BUS: 'BUS',
  RORO: 'RORO',
} as const;
export type BusType = (typeof BusType)[keyof typeof BusType];

export const SeatType = {
  REGULAR: 'REGULAR',
  PRIORITY: 'PRIORITY',
  DRIVER: 'DRIVER',
  RESERVED: 'RESERVED',
} as const;
export type SeatType = (typeof SeatType)[keyof typeof SeatType];

export const TripStatus = {
  SCHEDULED: 'SCHEDULED',
  BOARDING: 'BOARDING',
  DEPARTED: 'DEPARTED',
  ON_TRIP: 'ON_TRIP',
  ARRIVED: 'ARRIVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type TripStatus = (typeof TripStatus)[keyof typeof TripStatus];

export const TripSeatStatus = {
  AVAILABLE: 'AVAILABLE',
  HELD: 'HELD',
  BOOKED: 'BOOKED',
  BLOCKED: 'BLOCKED',
} as const;
export type TripSeatStatus = (typeof TripSeatStatus)[keyof typeof TripSeatStatus];

export const BookingStatus = {
  PENDING: 'PENDING',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  CONFIRMED: 'CONFIRMED',
  CHECKED_IN: 'CHECKED_IN',
  BOARDED: 'BOARDED',
  ON_TRIP: 'ON_TRIP',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  NO_SHOW: 'NO_SHOW',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const PassengerType = {
  ADULT: 'ADULT',
  CHILD: 'CHILD',
  SENIOR: 'SENIOR',
  STUDENT: 'STUDENT',
  PWD: 'PWD',
} as const;
export type PassengerType = (typeof PassengerType)[keyof typeof PassengerType];

/**
 * Only MOCK is implemented. The others are declared so the provider-agnostic
 * payment layer, the database enum, and the UI all agree on the vocabulary
 * when a real provider is added later. See docs/payment-flow.md.
 */
export const PaymentProvider = {
  MOCK: 'MOCK',
  STRIPE: 'STRIPE',
  GCASH: 'GCASH',
  MAYA: 'MAYA',
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

export const PaymentStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentTransactionType = {
  CREATED: 'CREATED',
  AUTHORIZED: 'AUTHORIZED',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;
export type PaymentTransactionType =
  (typeof PaymentTransactionType)[keyof typeof PaymentTransactionType];

export const WalletTransactionType = {
  TOP_UP: 'TOP_UP',
  BOOKING_PAYMENT: 'BOOKING_PAYMENT',
  REFUND: 'REFUND',
  REWARD: 'REWARD',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;
export type WalletTransactionType =
  (typeof WalletTransactionType)[keyof typeof WalletTransactionType];

export const LoyaltyTransactionType = {
  EARNED: 'EARNED',
  REDEEMED: 'REDEEMED',
  EXPIRED: 'EXPIRED',
  ADJUSTED: 'ADJUSTED',
  BONUS: 'BONUS',
} as const;
export type LoyaltyTransactionType =
  (typeof LoyaltyTransactionType)[keyof typeof LoyaltyTransactionType];

export const DiscountType = {
  FIXED: 'FIXED',
  PERCENTAGE: 'PERCENTAGE',
  PERK: 'PERK',
} as const;
export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

/**
 * Whether an account may sign in. Deliberately NOT the same thing as whether a
 * driver is free for work — see `AvailabilityStatus`. The single `StaffStatus`
 * this replaced could not say "can log in, but is on a rest day", which is the
 * ordinary case for crew.
 */
export const AccountStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

/** Whether a driver or conductor may be given a NEW trip. Nothing to do with sign-in. */
export const AvailabilityStatus = {
  AVAILABLE: 'AVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;
export type AvailabilityStatus = (typeof AvailabilityStatus)[keyof typeof AvailabilityStatus];

/**
 * Which kind of crew member, for the functions that take either.
 *
 * `CREW` is the role's name and the vocabulary the console uses. The table it
 * writes to is still `assistants` — renaming a table that a dozen policies and
 * eight verify suites join against would buy nothing — so the SQL functions
 * accept both spellings and normalise. See 20260916000034_role_hierarchy.sql.
 */
export const CrewKind = {
  DRIVER: 'DRIVER',
  CREW: 'CREW',
} as const;
export type CrewKind = (typeof CrewKind)[keyof typeof CrewKind];

export const AssignmentStatus = {
  ASSIGNED: 'ASSIGNED',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

export const ScanType = {
  VALIDATION: 'VALIDATION',
  BOARDING: 'BOARDING',
} as const;
export type ScanType = (typeof ScanType)[keyof typeof ScanType];

export const SOSStatus = {
  ACTIVE: 'ACTIVE',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESPONDING: 'RESPONDING',
  RESOLVED: 'RESOLVED',
  CANCELLED: 'CANCELLED',
} as const;
export type SOSStatus = (typeof SOSStatus)[keyof typeof SOSStatus];

export const NotificationType = {
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  TRIP_REMINDER: 'TRIP_REMINDER',
  TRIP_DELAY: 'TRIP_DELAY',
  TRIP_CANCELLED: 'TRIP_CANCELLED',
  BOARDING: 'BOARDING',
  SOS: 'SOS',
  REWARD: 'REWARD',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
