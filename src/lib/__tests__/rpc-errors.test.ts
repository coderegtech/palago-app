import { ErrorCode } from '@/constants/errors';
import { AppError, fromRpcError } from '@/lib/errors';

// Moved here from the booking-service tests in Phase 8: the mapping now lives
// in `@/lib/errors` because the tracking RPCs need the same translation. The
// reservation behaviour itself is verified against a real database by
// scripts/verify-booking.mjs, because atomicity cannot be shown with a mock.

/**
 * `reserve_seats` and friends raise exceptions whose message is one of our own
 * error codes. Postgres delivers that as a P0001 error with the code as the
 * message text, so the mapping back to a typed AppError is what stops raw SQL
 * prose reaching the UI.
 */
describe('fromRpcError', () => {
  it('recognises every code the reservation functions raise', () => {
    const raised = [
      ErrorCode.SEAT_UNAVAILABLE,
      ErrorCode.VALIDATION_ERROR,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.FORBIDDEN,
      ErrorCode.NOT_FOUND,
      ErrorCode.BOOKING_ALREADY_CONFIRMED,
    ];

    for (const code of raised) {
      const mapped = fromRpcError({ message: code, code: 'P0001', details: '', hint: '' });
      expect(mapped).toBeInstanceOf(AppError);
      expect(mapped.code).toBe(code);
    }
  });

  it('gives SEAT_UNAVAILABLE a message a passenger can act on', () => {
    const mapped = fromRpcError({
      message: ErrorCode.SEAT_UNAVAILABLE,
      code: 'P0001',
      details: '',
      hint: '',
    });
    expect(mapped.message).toMatch(/just been taken/i);
  });

  it('does not leak raw database prose for an unrecognised failure', () => {
    const mapped = fromRpcError({
      message: 'deadlock detected while waiting for ShareLock on transaction 4242',
      code: '40P01',
      details: '',
      hint: '',
    });
    expect(mapped.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(mapped.message).not.toMatch(/ShareLock/);
  });

  it('maps a dropped connection to a network error', () => {
    const mapped = fromRpcError(new TypeError('Network request failed'));
    expect(mapped.code).toBe(ErrorCode.NETWORK_ERROR);
  });

  it('passes an AppError through unchanged', () => {
    const original = new AppError(ErrorCode.BOOKING_EXPIRED);
    expect(fromRpcError(original)).toBe(original);
  });
});
