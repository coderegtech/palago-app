/**
 * validate-qr
 *
 * Verifies a scanned boarding QR and reports whether the passenger may board.
 *
 * Two independent checks, both required:
 *
 *   1. The HMAC signature, here — proves the QR was issued by PalaGo and not
 *      hand-made. A forged token never reaches the database.
 *   2. The booking state, in `validate_booking_qr` — proves the ticket is still
 *      good. A cancelled or already-boarded booking has a perfectly valid
 *      signature, so the signature alone would let it through.
 *
 * Returns a RESULT rather than an error for ticket problems: the operator at the
 * door needs to see which of unpaid / wrong trip / already boarded applies.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { fail, failFromRpc, handleOptions, ok } from '../_shared/http.ts';
import { requireSigningSecret, verifyBoardingToken } from '../_shared/qr-token.ts';

interface RequestBody {
  /** The raw QR contents, exactly as scanned. */
  payload?: string;
  /** The trip being boarded, so a valid ticket for another trip is caught. */
  expectedTripId?: string;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return fail('VALIDATION_ERROR', 'Use POST.', 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return fail('UNAUTHORIZED');

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return fail('VALIDATION_ERROR', 'Expected a JSON body.');
  }

  if (!body.payload) return fail('VALIDATION_ERROR', 'payload is required.');

  let secret: string;
  try {
    secret = requireSigningSecret();
  } catch (error) {
    console.error(error);
    return fail('INTERNAL_ERROR');
  }

  // Anything that is not our QR at all — a URL, a loyalty card, a random
  // barcode — lands here and is reported invalid rather than throwing.
  let parsed: { type?: string; bookingId?: string; reference?: string; token?: string };
  try {
    parsed = JSON.parse(body.payload);
  } catch {
    return ok({ result: 'INVALID_QR', valid: false });
  }

  if (parsed.type !== 'PALAGO_BOOKING' || !parsed.bookingId || !parsed.reference || !parsed.token) {
    return ok({ result: 'INVALID_QR', valid: false });
  }

  const verified = await verifyBoardingToken(parsed.token, secret);
  if (!verified.ok) {
    return ok({ result: verified.reason, valid: false });
  }

  // The signed payload wins over the surrounding JSON: a forger can rewrite the
  // outer bookingId freely, but not what was actually signed.
  if (verified.payload.bid !== parsed.bookingId || verified.payload.ref !== parsed.reference) {
    return ok({ result: 'INVALID_QR', valid: false });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } },
  );

  const { data, error } = await supabase.rpc('validate_booking_qr', {
    p_booking_id: verified.payload.bid,
    p_reference: verified.payload.ref,
    p_expected_trip_id: body.expectedTripId ?? null,
  });

  if (error) return failFromRpc(error);
  return ok(data);
});
