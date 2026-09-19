/**
 * create-test-payment
 *
 * Opens a MOCK payment for a booking the caller owns, and returns the data the
 * app needs to render the payment QR.
 *
 * Authenticated: the caller's JWT is forwarded to Postgres, so
 * `create_test_payment` sees the real `auth.uid()` and RLS plus the function's
 * own ownership check both apply. This function never decides who owns what.
 *
 * The amount is not accepted from the caller. It is computed in the database
 * from the booking, which itself got it from the trip fare.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { fail, failFromRpc, handleOptions, ok, serve } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import { resolveProvider } from '../_shared/payment-provider.ts';

interface RequestBody {
  bookingId?: string;
}

serve('create-test-payment', async (request) => {
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

  const bookingId = body.bookingId?.trim();
  if (!bookingId) return fail('VALIDATION_ERROR', 'bookingId is required.');

  const webBaseUrl = Deno.env.get('WEB_PAYMENT_BASE_URL');
  if (!webBaseUrl) {
    log.error('web_payment_base_url_missing');
    return fail('INTERNAL_ERROR');
  }

  let provider;
  try {
    provider = resolveProvider(Deno.env.get('PAYMENT_PROVIDER'), webBaseUrl);
  } catch (error) {
    log.error('payment_provider_unavailable', { error });
    return fail('INTERNAL_ERROR');
  }

  // Anon key plus the caller's Authorization header: this client acts *as the
  // user*, never with elevated privileges.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } },
  );

  const { data, error } = await supabase.rpc('create_test_payment', {
    p_booking_id: bookingId,
  });

  if (error) return failFromRpc(error);

  const payment = data as {
    paymentId: string;
    reference: string;
    token: string;
    amount: number;
    currency: string;
    status: string;
    expiresAt: string | null;
    reused: boolean;
  };

  const { paymentUrl } = await provider.createPayment({
    bookingId,
    amount: payment.amount,
    currency: payment.currency,
    reference: payment.reference,
    token: payment.token,
  });

  // Persisted through a privileged setter, not a table write: clients have no
  // UPDATE privilege on `payments`, and this function acts as the user.
  //
  // Treated as fatal. Without a stored URL the QR screen cannot be reopened
  // later — which is exactly the bug that a silent `console.error` here hid.
  const { error: urlError } = await supabase.rpc('set_payment_url', {
    p_payment_id: payment.paymentId,
    p_payment_url: paymentUrl,
  });

  if (urlError) {
    log.error('payment_url_not_persisted', { message: urlError.message });
    return failFromRpc(urlError);
  }

  return ok({
    paymentId: payment.paymentId,
    reference: payment.reference,
    paymentUrl,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    expiresAt: payment.expiresAt,
    provider: provider.name,
    /** True when an existing live payment was returned instead of a new one. */
    reused: payment.reused,
  });
});
