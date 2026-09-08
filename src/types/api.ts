/**
 * The response envelope every PalaGo Edge Function returns, and the payloads
 * shared between the app and the server.
 */

import type { ErrorCode } from '@/constants/errors';
import type { QR_BOOKING_TYPE } from '@/constants/config';
import type { Centavos, UUID } from '@/types/models';

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  code: ErrorCode;
  message: string;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function isApiFailure<T>(result: ApiResult<T>): result is ApiFailure {
  return result.success === false;
}

/**
 * The boarding QR payload. Deliberately minimal: an ID, a human-readable
 * reference, and a server-signed token. No passenger names, no seat numbers,
 * no payment details — anything printed here is readable by anyone who
 * photographs the screen.
 */
export interface BookingQRPayload {
  type: typeof QR_BOOKING_TYPE;
  bookingId: UUID;
  reference: string;
  token: string;
}

export interface CreatePaymentResult {
  paymentId: UUID;
  reference: string;
  paymentUrl: string;
  amount: Centavos;
  currency: string;
  status: string;
}
