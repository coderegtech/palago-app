/**
 * Error normalisation.
 *
 * Everything that can fail — Supabase Auth, PostgREST, Edge Functions, the
 * network — is converted into an `AppError` carrying one of our own
 * `ErrorCode`s, so screens branch on a code and never on message text.
 */

import { AuthError, PostgrestError } from '@supabase/supabase-js';

import { ERROR_MESSAGES, ErrorCode } from '@/constants/errors';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly cause?: unknown;

  constructor(code: ErrorCode, message?: string, cause?: unknown) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Supabase Auth statuses mapped to our codes. Auth messages are written for end
 * users and are safe to surface, with one exception: "Invalid login
 * credentials" is deliberately vague about *which* half was wrong, and we keep
 * it that way rather than helpfully confirming that an email exists.
 */
function fromAuthError(error: AuthError): AppError {
  switch (error.status) {
    case 400:
      return new AppError(ErrorCode.VALIDATION_ERROR, error.message, error);
    case 401:
    case 403:
      return new AppError(ErrorCode.UNAUTHORIZED, error.message, error);
    case 404:
      return new AppError(ErrorCode.NOT_FOUND, error.message, error);
    case 422:
      return new AppError(ErrorCode.VALIDATION_ERROR, error.message, error);
    case 429:
      return new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Too many attempts. Please wait a moment and try again.',
        error,
      );
    default:
      return new AppError(ErrorCode.INTERNAL_ERROR, undefined, error);
  }
}

/**
 * PostgREST codes. `42501` (insufficient privilege) and `PGRST116` (no rows
 * where one was expected) are the two an RLS-protected client meets most: both
 * mean "not yours", and neither should leak whether the row exists.
 */
function fromPostgrestError(error: PostgrestError): AppError {
  switch (error.code) {
    case '42501':
      return new AppError(ErrorCode.FORBIDDEN, undefined, error);
    case 'PGRST116':
      return new AppError(ErrorCode.NOT_FOUND, undefined, error);
    case '23505':
      return new AppError(
        ErrorCode.VALIDATION_ERROR,
        'That record already exists.',
        error,
      );
    default:
      return new AppError(ErrorCode.INTERNAL_ERROR, undefined, error);
  }
}

/**
 * A SECURITY DEFINER function's `raise exception 'SEAT_UNAVAILABLE'` arrives as
 * a PostgREST error whose *message* is the code. Anything unrecognised falls
 * through to `toAppError`, so a genuine database fault is not relabelled as a
 * business rule.
 */
export function fromRpcError(error: unknown): AppError {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';

  if (message in ErrorCode) {
    return new AppError(message as ErrorCode, undefined, error);
  }
  return toAppError(error);
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof AuthError) return fromAuthError(error);

  if (isPostgrestError(error)) return fromPostgrestError(error);

  // supabase-js surfaces a dropped connection as a plain TypeError from fetch.
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return new AppError(ErrorCode.NETWORK_ERROR, undefined, error);
  }

  return new AppError(
    ErrorCode.INTERNAL_ERROR,
    error instanceof Error ? error.message : undefined,
    error,
  );
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'details' in error
  );
}
