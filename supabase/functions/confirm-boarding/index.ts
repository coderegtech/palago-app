/**
 * confirm-boarding
 *
 * Boards passengers of a booking at the trip being boarded, each at most once.
 * Refusals (wrong trip, boarding not open, already boarded…) come back as a
 * `result` with `boarded: false`, not as an error, so they are logged.
 *
 * Re-verifies the signature rather than trusting a bookingId sent by the
 * client. Without that, an operator device could board any booking id it could
 * guess — which is exactly the check validate-qr exists to make, so skipping it
 * here would leave the door open one step later.
 *
 * Duplicate-scan protection lives in `confirm_boarding`: a row lock plus a
 * status precondition, so two operators scanning the same ticket at the same
 * moment cannot both board it.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { fail, failFromRpc, handleOptions, ok, serve } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import { requireSigningSecret, verifyBoardingToken } from '../_shared/qr-token.ts';

serve('confirm-boarding', async (request) => {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return fail('VALIDATION_ERROR', 'Use POST.', 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return fail('UNAUTHORIZED');

  let body: { payload?: string; tripId?: string; passengerIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return fail('VALIDATION_ERROR', 'Expected a JSON body.');
  }

  if (!body.payload) return fail('VALIDATION_ERROR', 'payload is required.');
  if (!body.tripId) return fail('VALIDATION_ERROR', 'tripId — the trip being boarded — is required.');
  if (body.passengerIds !== undefined && !Array.isArray(body.passengerIds)) {
    return fail('VALIDATION_ERROR', 'passengerIds must be a list.');
  }

  let secret: string;
  try {
    secret = requireSigningSecret();
  } catch (error) {
    log.error('signing_secret_missing', { error });
    return fail('INTERNAL_ERROR');
  }

  let parsed: { type?: string; bookingId?: string; reference?: string; token?: string };
  try {
    parsed = JSON.parse(body.payload);
  } catch {
    return fail('INVALID_QR');
  }

  if (parsed.type !== 'PALAGO_BOOKING' || !parsed.token) return fail('INVALID_QR');

  const verified = await verifyBoardingToken(parsed.token, secret);
  if (!verified.ok) return fail(verified.reason);

  if (verified.payload.bid !== parsed.bookingId || verified.payload.ref !== parsed.reference) {
    return fail('INVALID_QR');
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } },
  );

  const { data, error } = await supabase.rpc('confirm_boarding', {
    p_booking_id: verified.payload.bid,
    p_trip_id: body.tripId,
    // Omitted means everyone on the booking not yet boarded.
    p_passenger_ids: body.passengerIds ?? null,
    p_method: 'QR',
  });

  if (error) return failFromRpc(error);
  return ok(data);
});
