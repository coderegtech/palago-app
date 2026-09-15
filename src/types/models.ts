/**
 * PalaGo domain models.
 *
 * MONEY: every amount is an integer number of centavos (₱450.00 → 45000).
 * Floating point pesos would drift across fare × passengers × discount
 * arithmetic and stop matching the server's total. Use `formatMoney` from
 * `@/utils/money` for display and never do currency maths in floats.
 *
 * TIME: all timestamps are ISO-8601 UTC strings as returned by PostgreSQL.
 */

import type {
  AccountStatus,
  AvailabilityStatus,
  AssignmentStatus,
  BookingStatus,
  BusType,
  DiscountType,
  LoyaltyTransactionType,
  NotificationType,
  OperatorStatus,
  PassengerType,
  PaymentProvider,
  PaymentStatus,
  PaymentTransactionType,
  SOSStatus,
  ScanType,
  SeatType,
  TripSeatStatus,
  TripStatus,
  UserRole,
  WalletTransactionType,
} from '@/constants/enums';
import type { Json } from '@/types/database';

/** An integer amount in centavos. */
export type Centavos = number;

export type UUID = string;
export type ISODateTime = string;
/** Calendar date, `YYYY-MM-DD`. */
export type ISODate = string;
/** Wall-clock time, `HH:mm` or `HH:mm:ss`. */
export type ISOTime = string;

export interface Profile {
  id: UUID;
  fullName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  role: UserRole;
  /** Operator this staff account belongs to. NULL for passengers and admins. */
  operatorId: UUID | null;
  /**
   * Whether this account may sign in at all. A deactivated one can still load
   * its own profile — that is how the app knows to say why it stopped working —
   * but RLS answers it nothing else.
   */
  accountStatus: AccountStatus;
  /** Set when an account is provisioned or reset with a temporary password. */
  mustChangePassword: boolean;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Operator {
  id: UUID;
  name: string;
  code: string;
  logoUrl: string | null;
  description: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  status: OperatorStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Terminal {
  id: UUID;
  name: string;
  code: string;
  address: string | null;
  latitude: number;
  longitude: number;
  city: string;
  province: string;
  status: OperatorStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Route {
  id: UUID;
  operatorId: UUID;
  originTerminalId: UUID;
  destinationTerminalId: UUID;
  durationMinutes: number;
  distanceKm: number | null;
  status: OperatorStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Bus {
  id: UUID;
  operatorId: UUID;
  plateNumber: string;
  busNumber: string;
  name: string | null;
  busType: BusType;
  capacity: number;
  status: OperatorStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface BusSeat {
  id: UUID;
  busId: UUID;
  seatNumber: string;
  rowNumber: number;
  columnNumber: number;
  seatType: SeatType;
  isWindow: boolean;
  isAisle: boolean;
  status: OperatorStatus;
  createdAt: ISODateTime;
}

export interface Trip {
  id: UUID;
  operatorId: UUID;
  routeId: UUID;
  busId: UUID;
  tripNumber: string;
  departureDate: ISODate;
  departureTime: ISOTime;
  arrivalTime: ISOTime;
  fare: Centavos;
  status: TripStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface TripSeat {
  id: UUID;
  tripId: UUID;
  seatId: UUID;
  status: TripSeatStatus;
  bookingId: UUID | null;
  heldBy: UUID | null;
  heldUntil: ISODateTime | null;
  confirmedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Booking {
  id: UUID;
  userId: UUID;
  tripId: UUID;
  bookingReference: string;
  status: BookingStatus;
  subtotal: Centavos;
  discount: Centavos;
  loyaltyDiscount: Centavos;
  totalAmount: Centavos;
  currency: string;
  expiresAt: ISODateTime | null;
  confirmedAt: ISODateTime | null;
  cancelledAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface BookingPassenger {
  id: UUID;
  bookingId: UUID;
  userId: UUID | null;
  seatId: UUID;
  passengerName: string;
  phone: string | null;
  email: string | null;
  passengerType: PassengerType;
  createdAt: ISODateTime;
}

export interface Payment {
  id: UUID;
  bookingId: UUID;
  reference: string;
  provider: PaymentProvider;
  amount: Centavos;
  currency: string;
  status: PaymentStatus;
  paymentUrl: string | null;
  receiptNumber: string | null;
  paidAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PaymentTransaction {
  id: UUID;
  paymentId: UUID;
  type: PaymentTransactionType;
  amount: Centavos;
  status: PaymentStatus;
  reference: string | null;
  metadata: Json | null;
  createdAt: ISODateTime;
}

export interface Receipt {
  id: UUID;
  paymentId: UUID;
  bookingId: UUID;
  receiptNumber: string;
  amount: Centavos;
  currency: string;
  paymentMethod: string;
  status: PaymentStatus;
  issuedAt: ISODateTime;
}

export interface Wallet {
  id: UUID;
  userId: UUID;
  balance: Centavos;
  currency: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface WalletTransaction {
  id: UUID;
  walletId: UUID;
  type: WalletTransactionType;
  amount: Centavos;
  balanceBefore: Centavos;
  balanceAfter: Centavos;
  reference: string | null;
  description: string | null;
  status: PaymentStatus;
  createdAt: ISODateTime;
}

export interface LoyaltyAccount {
  id: UUID;
  userId: UUID;
  pointsBalance: number;
  lifetimePoints: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface LoyaltyTransaction {
  id: UUID;
  userId: UUID;
  type: LoyaltyTransactionType;
  points: number;
  balanceBefore: number;
  balanceAfter: number;
  reference: string | null;
  description: string | null;
  createdAt: ISODateTime;
}

export interface Reward {
  id: UUID;
  name: string;
  description: string | null;
  pointsRequired: number;
  discountType: DiscountType;
  /** Centavos for FIXED, basis points for PERCENTAGE, unused for PERK. */
  discountValue: number;
  status: OperatorStatus;
}

export interface RewardRedemption {
  id: UUID;
  userId: UUID;
  rewardId: UUID;
  pointsUsed: number;
  bookingId: UUID | null;
  status: OperatorStatus;
  redeemedAt: ISODateTime;
}

export interface Driver {
  id: UUID;
  operatorId: UUID;
  userId: UUID | null;
  licenseNumber: string;
  licenseExpirationDate: ISODate | null;
  name: string;
  phone: string | null;
  /**
   * Whether they may be given a NEW trip. Whether they may sign in is
   * `Profile.accountStatus` — the two are deliberately separate, so a driver on
   * a rest day keeps their access and simply is not rostered.
   */
  availabilityStatus: AvailabilityStatus;
  unavailableReason: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Assistant {
  id: UUID;
  operatorId: UUID;
  userId: UUID | null;
  name: string;
  phone: string | null;
  availabilityStatus: AvailabilityStatus;
  unavailableReason: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface TripAssignment {
  id: UUID;
  tripId: UUID;
  driverId: UUID | null;
  assistantId: UUID | null;
  assignedAt: ISODateTime;
  status: AssignmentStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface BusLocation {
  id: UUID;
  tripId: UUID;
  busId: UUID;
  driverId: UUID;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  recordedAt: ISODateTime;
}

export interface AppNotification {
  id: UUID;
  userId: UUID;
  type: NotificationType;
  title: string;
  message: string;
  data: Json | null;
  readAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface SOSIncident {
  id: UUID;
  userId: UUID;
  bookingId: UUID | null;
  tripId: UUID | null;
  latitude: number | null;
  longitude: number | null;
  message: string | null;
  status: SOSStatus;
  createdAt: ISODateTime;
  acknowledgedAt: ISODateTime | null;
  resolvedAt: ISODateTime | null;
}

export interface QRScan {
  id: UUID;
  bookingId: UUID;
  operatorUserId: UUID;
  tripId: UUID;
  scanType: ScanType;
  result: string;
  scannedAt: ISODateTime;
}

export interface AuditLog {
  id: UUID;
  actorUserId: UUID | null;
  action: string;
  entityType: string;
  entityId: UUID | null;
  metadata: Json | null;
  ipAddress: string | null;
  createdAt: ISODateTime;
}
