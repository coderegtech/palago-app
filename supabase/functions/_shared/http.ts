/**
 * Shared HTTP plumbing for PalaGo Edge Functions.
 *
 * Every function returns the same envelope so the client can branch on `code`
 * and never on message text:
 *
 *   { success: true,  data: … }
 *   { success: false, code: "SEAT_UNAVAILABLE", message: "…" }
 *
 * The codes match src/constants/errors.ts exactly.
 */

export const ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'BOOKING_EXPIRED',
  'SEAT_UNAVAILABLE',
  'PAYMENT_EXPIRED',
  'PAYMENT_ALREADY_CONFIRMED',
  'BOOKING_ALREADY_CONFIRMED',
  'INVALID_QR',
  'QR_EXPIRED',
  'ALREADY_BOARDED',
  'WRONG_TRIP',
  'UNPAID_BOOKING',
  'SCHEDULE_CONFLICT',
  'INACTIVE_RESOURCE',
  'ACCOUNT_DISABLED',
  'EMAIL_TAKEN',
  'LICENSE_EXPIRED',
  'NETWORK_ERROR',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const FALLBACK_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHORIZED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'We could not find what you were looking for.',
  VALIDATION_ERROR: 'Please check the information you entered.',
  BOOKING_EXPIRED: 'This booking has expired. Please start again.',
  SEAT_UNAVAILABLE: 'One or more of those seats have just been taken.',
  PAYMENT_EXPIRED: 'This payment has expired. Please create a new booking.',
  PAYMENT_ALREADY_CONFIRMED: 'This payment has already been confirmed.',
  BOOKING_ALREADY_CONFIRMED: 'This booking has already been confirmed.',
  INVALID_QR: 'This QR code is not a valid PalaGo payment link.',
  QR_EXPIRED: 'This link has expired.',
  ALREADY_BOARDED: 'This passenger has already boarded.',
  WRONG_TRIP: 'This ticket is for a different trip.',
  UNPAID_BOOKING: 'This booking has not been paid for.',
  SCHEDULE_CONFLICT: 'That clashes with another trip already on the schedule.',
  INACTIVE_RESOURCE: 'That is no longer active and cannot be used for a new booking.',
  ACCOUNT_DISABLED: 'This account has been deactivated. Ask your operator or an administrator.',
  EMAIL_TAKEN: 'An account already exists for that email address.',
  LICENSE_EXPIRED: 'That licence has expired before the departure date.',
  NETWORK_ERROR: 'No internet connection. Please try again.',
  INTERNAL_ERROR: 'Something went wrong on our end. Please try again.',
};

/**
 * The payment page is opened from a QR on a device that is not running the app,
 * so it is a genuinely cross-origin caller and needs CORS. Only the headers
 * actually used are allowed.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

export function ok<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), { status, headers: jsonHeaders });
}

export function fail(code: ErrorCode, message?: string, status?: number): Response {
  const httpStatus =
    status ??
    (code === 'UNAUTHORIZED'
      ? 401
      : code === 'FORBIDDEN'
        ? 403
        : code === 'NOT_FOUND' || code === 'INVALID_QR'
          ? 404
          : code === 'INTERNAL_ERROR'
            ? 500
            : 400);

  return new Response(
    JSON.stringify({ success: false, code, message: message ?? FALLBACK_MESSAGES[code] }),
    { status: httpStatus, headers: jsonHeaders },
  );
}

export function handleOptions(): Response {
  return new Response('ok', { headers: corsHeaders });
}

function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * The database functions raise exceptions whose message is one of our codes.
 * Anything else is an internal error and its detail is deliberately NOT
 * forwarded — raw Postgres prose can disclose schema details, and it is
 * meaningless to the person reading the screen.
 */
export function failFromRpc(error: { message?: string } | null): Response {
  const message = error?.message ?? '';
  if (isErrorCode(message)) return fail(message);

  console.error('Unmapped RPC error:', message);
  return fail('INTERNAL_ERROR');
}

/** Best-effort caller IP, for the audit trail. */
export function callerIp(request: Request): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('cf-connecting-ip') ??
    null
  );
}
