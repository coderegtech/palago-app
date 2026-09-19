/**
 * Reporting failures the app recovered from, through EAS Observe.
 *
 * Only the unexpected ones. A refusal the server meant — FORBIDDEN,
 * SEAT_UNAVAILABLE, a wrong phrase, an expired payment — is the system
 * working, and reporting it would bury the real faults under every passenger
 * who picked a taken seat. What is reported: INTERNAL_ERROR, NETWORK_ERROR (a
 * rate worth watching even though each one is expected), and anything that is
 * not an AppError at all, which by definition nobody planned for.
 *
 * Attributes are deliberately thin: where it happened (a query key's root or a
 * function name), the code, and the server's request id — the id is what joins
 * a report here to the Edge Function's own log line (supabase/functions/
 * _shared/log.ts). Never a booking id, reference, e-mail or message body: this
 * goes to a third party's dashboard. See docs/observability.md.
 *
 * Observe dispatches from release builds only, so a dev session sends nothing.
 */

import { Observe } from 'expo-observe';

import { ErrorCode } from '@/constants/errors';
import { AppError } from '@/lib/errors';

const REPORTED_CODES: readonly ErrorCode[] = [ErrorCode.INTERNAL_ERROR, ErrorCode.NETWORK_ERROR];

export function shouldReport(error: unknown): boolean {
  if (error instanceof AppError) return REPORTED_CODES.includes(error.code);
  return true;
}

export function reportFailure(error: unknown, where: string): void {
  if (!shouldReport(error)) return;

  try {
    const code = error instanceof AppError ? error.code : 'UNEXPECTED';
    Observe.logEvent('app_failure', {
      severity: code === ErrorCode.NETWORK_ERROR ? 'warn' : 'error',
      attributes: {
        where,
        code,
        ...(error instanceof AppError && error.requestId ? { requestId: error.requestId } : {}),
      },
    });
    // The network is not a bug; only the rest carries a stack worth reading.
    if (code !== ErrorCode.NETWORK_ERROR) Observe.reportError(error);
  } catch {
    // Reporting must never be the thing that breaks the screen.
  }
}
