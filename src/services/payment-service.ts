/**
 * Payments — MOCK ONLY.
 *
 * Every operation goes through an Edge Function, never a table write. The
 * client has no write privilege on `payments`, `receipts` or `bookings`, so
 * there is no second path that would need keeping consistent.
 *
 * Nothing here decides an amount. `create_test_payment` computes it in the
 * database from the booking, which got it from the trip fare.
 *
 * No real provider is contacted at any point. See docs/payment-flow.md.
 */

import { AppError, toAppError } from '@/lib/errors';
import { ErrorCode } from '@/constants/errors';
import { supabase } from '@/lib/supabase';
import type { PaymentStatus, PaymentProvider, BookingStatus, PassengerType } from '@/constants/enums';
import type { Centavos, ISODate, ISOTime, UUID } from '@/types/models';

/** The `{ success, code, message }` envelope every PalaGo Edge Function returns. */
type Envelope<T> = { success: true; data: T } | { success: false; code: string; message: string };

/**
 * Calls an Edge Function and unwraps the envelope.
 *
 * `supabase.functions.invoke` reports a non-2xx as a FunctionsHttpError whose
 * body has to be read separately, so the error branch parses it to recover our
 * own code rather than surfacing "Edge Function returned a non-2xx status".
 */
async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<Envelope<T>>(name, { body });

  if (error) {
    const parsed = await readErrorEnvelope(error);
    if (parsed) throw parsed;
    throw toAppError(error);
  }

  if (!data) throw new AppError(ErrorCode.INTERNAL_ERROR);
  if (!data.success) {
    throw new AppError(
      (data.code as ErrorCode) in ErrorCode ? (data.code as ErrorCode) : ErrorCode.INTERNAL_ERROR,
      data.message,
    );
  }

  return data.data;
}

async function readErrorEnvelope(error: unknown): Promise<AppError | null> {
  const response = (error as { context?: Response })?.context;
  if (!response || typeof response.json !== 'function') return null;

  try {
    const body = (await response.json()) as { code?: string; message?: string };
    if (body?.code && body.code in ErrorCode) {
      return new AppError(body.code as ErrorCode, body.message);
    }
  } catch {
    // Body was not our envelope; fall through to the generic mapping.
  }
  return null;
}

export interface CreatedPayment {
  paymentId: UUID;
  reference: string;
  /** Encoded into the payment QR. Contains the bearer token as a query param. */
  paymentUrl: string;
  amount: Centavos;
  currency: string;
  status: PaymentStatus;
  expiresAt: string | null;
  provider: PaymentProvider;
  /** True when an existing live payment was returned instead of a new one. */
  reused: boolean;
}

export interface PublicPaymentPassenger {
  name: string;
  seat: string;
  type: PassengerType;
}

export interface PublicPaymentReceipt {
  receiptNumber: string;
  amount: Centavos;
  currency: string;
  paymentMethod: string;
  issuedAt: string;
}

/** What the public payment page is allowed to see. Never includes the token. */
export interface PublicPayment {
  paymentReference: string;
  paymentStatus: PaymentStatus;
  provider: PaymentProvider;
  amount: Centavos;
  currency: string;
  expiresAt: string | null;
  paidAt: string | null;
  isExpired: boolean;
  bookingReference: string;
  bookingStatus: BookingStatus;
  subtotal: Centavos;
  discount: Centavos;
  loyaltyDiscount: Centavos;
  totalAmount: Centavos;
  operatorName: string;
  tripNumber: string;
  departureDate: ISODate;
  departureTime: ISOTime;
  originName: string;
  originCode: string;
  destinationName: string;
  destinationCode: string;
  passengers: PublicPaymentPassenger[];
  receipt: PublicPaymentReceipt | null;
}

export interface ConfirmationResult {
  alreadyConfirmed: boolean;
  paymentReference: string;
  paymentStatus: PaymentStatus;
  bookingReference: string;
  bookingStatus: BookingStatus;
  receiptNumber: string;
  amount: Centavos;
  currency: string;
  paidAt: string;
  issuedAt: string;
}

export const paymentService = {
  /** Opens a mock payment for a booking the caller owns. Idempotent. */
  createPayment(bookingId: UUID): Promise<CreatedPayment> {
    return callFunction<CreatedPayment>('create-test-payment', { bookingId });
  },

  /**
   * Reads the safe payment summary for the public page.
   * Authorised by the token from the QR, not by a session.
   */
  getPublicPayment(reference: string, token: string): Promise<PublicPayment> {
    return callFunction<PublicPayment>('get-payment', { reference, token });
  },

  /**
   * Confirms the mock payment.
   *
   * Idempotent: a second call returns the same receipt with
   * `alreadyConfirmed: true` rather than failing, because a retry after a
   * dropped connection is ordinary.
   */
  confirmPayment(reference: string, token: string): Promise<ConfirmationResult> {
    return callFunction<ConfirmationResult>('confirm-test-payment', { reference, token });
  },

  /** The receipt for a confirmed booking, for the signed-in owner. */
  async getReceipt(bookingId: UUID) {
    const { data, error } = await supabase
      .from('receipts')
      .select('receipt_number, amount, currency, payment_method, status, issued_at')
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (error) throw toAppError(error);
    if (!data) return null;

    return {
      receiptNumber: data.receipt_number,
      amount: data.amount,
      currency: data.currency,
      paymentMethod: data.payment_method,
      status: data.status,
      issuedAt: data.issued_at,
    };
  },

  /** The live payment for a booking, if there is one. */
  async getPaymentForBooking(bookingId: UUID) {
    const { data, error } = await supabase
      .from('payments')
      .select('id, reference, status, amount, currency, payment_url, expires_at, paid_at')
      .eq('booking_id', bookingId)
      .in('status', ['PENDING', 'PROCESSING', 'PAID'])
      .maybeSingle();

    if (error) throw toAppError(error);
    if (!data) return null;

    return {
      id: data.id,
      reference: data.reference,
      status: data.status as PaymentStatus,
      amount: data.amount,
      currency: data.currency,
      paymentUrl: data.payment_url,
      expiresAt: data.expires_at,
      paidAt: data.paid_at,
    };
  },
};
