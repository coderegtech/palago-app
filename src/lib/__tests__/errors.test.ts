import { AuthError } from '@supabase/supabase-js';

import { ErrorCode } from '@/constants/errors';
import { AppError, toAppError } from '@/lib/errors';

describe('toAppError', () => {
  it('passes an AppError through unchanged', () => {
    const original = new AppError(ErrorCode.SEAT_UNAVAILABLE);
    expect(toAppError(original)).toBe(original);
  });

  it('maps auth 400/422 to a validation error', () => {
    expect(toAppError(new AuthError('bad request', 400)).code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(toAppError(new AuthError('unprocessable', 422)).code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('maps auth 401/403 to unauthorized', () => {
    expect(toAppError(new AuthError('nope', 401)).code).toBe(ErrorCode.UNAUTHORIZED);
    expect(toAppError(new AuthError('nope', 403)).code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('keeps the vague wording of invalid credentials', () => {
    // Rewording this to "no account with that email" would confirm which
    // addresses are registered.
    const error = toAppError(new AuthError('Invalid login credentials', 400));
    expect(error.message).toBe('Invalid login credentials');
  });

  it('turns rate limiting into advice the user can act on', () => {
    expect(toAppError(new AuthError('too many', 429)).message).toMatch(/wait a moment/i);
  });

  it('maps a PostgREST privilege failure to FORBIDDEN', () => {
    const error = toAppError({
      code: '42501',
      message: 'permission denied for table profiles',
      details: '',
      hint: '',
      name: 'PostgrestError',
    });
    expect(error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('maps "no rows returned" to NOT_FOUND rather than leaking existence', () => {
    const error = toAppError({
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
      details: '',
      hint: '',
      name: 'PostgrestError',
    });
    expect(error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('recognises a dropped connection', () => {
    expect(toAppError(new TypeError('Failed to fetch')).code).toBe(ErrorCode.NETWORK_ERROR);
  });

  it('falls back to an internal error for anything unrecognised', () => {
    expect(toAppError('something odd').code).toBe(ErrorCode.INTERNAL_ERROR);
  });
});
