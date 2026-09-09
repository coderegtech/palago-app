/**
 * Boarding passes and scanning.
 *
 * The boarding QR is a different credential from the payment QR and is issued
 * only after payment is confirmed. Its token is HMAC-signed by an Edge Function
 * secret the app never holds, so the app can render a pass but cannot mint one.
 *
 * Validation and boarding are equally server-side. This module never decides
 * whether a ticket is good.
 */

import { AppError, toAppError } from '@/lib/errors';
import { ErrorCode } from '@/constants/errors';
import { QR_BOOKING_TYPE } from '@/constants/config';
import { supabase } from '@/lib/supabase';
import type { BookingQRPayload } from '@/types/api';
import type { PassengerType, BookingStatus, PaymentStatus, ScanType } from '@/constants/enums';
import type { ISODate, ISOTime, UUID } from '@/types/models';

type Envelope<T> = { success: true; data: T } | { success: false; code: string; message: string };

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
    // Not our envelope.
  }
  return null;
}

export interface BoardingPass extends BookingQRPayload {
  expiresAt: string;
}

/** What the scanner shows the operator. `result` is a code, not prose. */
export interface ScanResult {
  result:
    | 'VALID'
    | 'INVALID_QR'
    | 'QR_EXPIRED'
    | 'ALREADY_BOARDED'
    | 'UNPAID_BOOKING'
    | 'WRONG_TRIP';
  valid: boolean;
  bookingId?: UUID;
  bookingReference?: string;
  bookingStatus?: BookingStatus;
  boardedAt?: string | null;
  operatorName?: string;
  tripNumber?: string;
  tripId?: UUID;
  departureDate?: ISODate;
  departureTime?: ISOTime;
  originCode?: string;
  originName?: string;
  destinationCode?: string;
  destinationName?: string;
  paymentStatus?: PaymentStatus | 'NONE';
  passengers?: { name: string; seat: string; type: PassengerType }[];
}

export interface BoardingResult {
  boarded: boolean;
  alreadyBoarded: boolean;
  result: string;
  bookingReference: string;
  boardedAt: string | null;
}

export const qrService = {
  /**
   * The boarding pass for a paid booking.
   *
   * Throws `UNPAID_BOOKING` when the booking has not been paid — the refusal
   * is the feature, not a gap.
   */
  getBoardingPass(bookingId: UUID): Promise<BoardingPass> {
    return callFunction<BoardingPass>('get-boarding-pass', { bookingId });
  },

  /** What the app encodes into the QR image. */
  toQRString(pass: BoardingPass): string {
    return JSON.stringify({
      type: QR_BOOKING_TYPE,
      bookingId: pass.bookingId,
      reference: pass.reference,
      token: pass.token,
    });
  },

  /**
   * Validates a scanned payload. Ticket problems come back as a `result`, not
   * an exception, because the operator needs to see which problem it is.
   */
  validateScan(payload: string, expectedTripId?: UUID): Promise<ScanResult> {
    return callFunction<ScanResult>('validate-qr', { payload, expectedTripId });
  },

  confirmBoarding(payload: string): Promise<BoardingResult> {
    return callFunction<BoardingResult>('confirm-boarding', { payload });
  },

  /** Recent scans for a trip, for the operator's own record. */
  async listScans(tripId: UUID) {
    const { data, error } = await supabase
      .from('qr_scans')
      .select('id, scan_type, result, scanned_at, booking_id')
      .eq('trip_id', tripId)
      .order('scanned_at', { ascending: false })
      .limit(50);

    if (error) throw toAppError(error);

    return data.map((row) => ({
      id: row.id,
      scanType: row.scan_type as ScanType,
      result: row.result,
      scannedAt: row.scanned_at,
      bookingId: row.booking_id,
    }));
  },
};
