/**
 * get-boarding-pass
 *
 * Issues the boarding QR payload for a booking the caller owns.
 *
 * The pass is issued HERE, server-side, because the token is HMAC-signed with a
 * secret the app never sees. The client only renders what it is given.
 *
 * Refuses unless the booking is actually paid and confirmed. That refusal is
 * the point of the whole phase: a boarding pass must not exist before payment.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { fail, handleOptions, ok, serve } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import { requireSigningSecret, signBoardingToken } from '../_shared/qr-token.ts';

/** How long a pass stays valid. Comfortably longer than any Palawan trip. */
const TTL_SECONDS = 48 * 60 * 60;

serve('get-boarding-pass', async (request) => {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return fail('VALIDATION_ERROR', 'Use POST.', 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return fail('UNAUTHORIZED');

  let body: { bookingId?: string };
  try {
    body = await request.json();
  } catch {
    return fail('VALIDATION_ERROR', 'Expected a JSON body.');
  }

  const bookingId = body.bookingId?.trim();
  if (!bookingId) return fail('VALIDATION_ERROR', 'bookingId is required.');

  let secret: string;
  try {
    secret = requireSigningSecret();
  } catch (error) {
    log.error('signing_secret_missing', { error });
    return fail('INTERNAL_ERROR');
  }

  // Acts as the caller, so RLS decides which bookings are visible at all.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } },
  );

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, booking_reference, status, trip_id')
    .eq('id', bookingId)
    .maybeSingle();

  if (error) {
    log.error('booking_read_failed', { message: error.message });
    return fail('INTERNAL_ERROR');
  }
  if (!booking) return fail('NOT_FOUND');

  // A pass is only issued for a booking that has been paid for. Anything else
  // and the passenger has nothing to board with — by design.
  if (booking.status === 'PENDING' || booking.status === 'PAYMENT_PENDING') {
    return fail('UNPAID_BOOKING');
  }
  if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') {
    return fail('INVALID_QR', 'This booking is no longer valid.');
  }
  if (!['CONFIRMED', 'CHECKED_IN', 'BOARDED', 'ON_TRIP', 'COMPLETED'].includes(booking.status)) {
    return fail('VALIDATION_ERROR');
  }

  const { data: payment } = await supabase
    .from('payments')
    .select('status')
    .eq('booking_id', bookingId)
    .eq('status', 'PAID')
    .maybeSingle();

  if (!payment) return fail('UNPAID_BOOKING');

  const issuedAt = Math.floor(Date.now() / 1000);
  const token = await signBoardingToken(
    {
      bid: booking.id,
      ref: booking.booking_reference,
      iat: issuedAt,
      exp: issuedAt + TTL_SECONDS,
    },
    secret,
  );

  // Exactly the payload shape in the spec. Nothing identifying beyond the
  // reference the passenger can already read off their own ticket.
  return ok({
    type: 'PALAGO_BOOKING',
    bookingId: booking.id,
    reference: booking.booking_reference,
    token,
    expiresAt: new Date((issuedAt + TTL_SECONDS) * 1000).toISOString(),
  });
});
