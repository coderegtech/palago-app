/**
 * Standard API error codes.
 *
 * Every Edge Function returns `{ success: false, code, message }` using one of
 * these codes so the client can branch on `code` and never on message text.
 */

export const ErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BOOKING_EXPIRED: 'BOOKING_EXPIRED',
  SEAT_UNAVAILABLE: 'SEAT_UNAVAILABLE',
  PAYMENT_EXPIRED: 'PAYMENT_EXPIRED',
  PAYMENT_ALREADY_CONFIRMED: 'PAYMENT_ALREADY_CONFIRMED',
  BOOKING_ALREADY_CONFIRMED: 'BOOKING_ALREADY_CONFIRMED',
  INVALID_QR: 'INVALID_QR',
  QR_EXPIRED: 'QR_EXPIRED',
  ALREADY_BOARDED: 'ALREADY_BOARDED',
  WRONG_TRIP: 'WRONG_TRIP',
  UNPAID_BOOKING: 'UNPAID_BOOKING',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Fallback copy. Server-supplied messages take precedence over these. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHORIZED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'We could not find what you were looking for.',
  VALIDATION_ERROR: 'Please check the information you entered.',
  BOOKING_EXPIRED: 'This booking has expired. Please start again.',
  SEAT_UNAVAILABLE: 'One or more of those seats have just been taken.',
  PAYMENT_EXPIRED: 'This payment has expired. Please create a new booking.',
  PAYMENT_ALREADY_CONFIRMED: 'This payment has already been confirmed.',
  BOOKING_ALREADY_CONFIRMED: 'This booking has already been confirmed.',
  INVALID_QR: 'This QR code is not a valid PalaGo ticket.',
  QR_EXPIRED: 'This ticket has expired.',
  ALREADY_BOARDED: 'This passenger has already boarded.',
  WRONG_TRIP: 'This ticket is for a different trip.',
  UNPAID_BOOKING: 'This booking has not been paid for.',
  NETWORK_ERROR: 'No internet connection. Please try again.',
  INTERNAL_ERROR: 'Something went wrong on our end. Please try again.',
};
