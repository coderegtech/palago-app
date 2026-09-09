/**
 * confirm-test-payment
 *
 * Confirms a MOCK payment: marks it PAID, issues the receipt, confirms the
 * booking, turns the seat holds into bookings, and writes the ledger, audit and
 * notification rows. All of it in one database transaction, inside
 * `confirm_test_payment`.
 *
 * PUBLIC (verify_jwt = false), for the same reason as get-payment: the payer's
 * browser has no session. The QR token is the credential.
 *
 * IDEMPOTENT. Calling this five times leaves one payment, one receipt and one
 * booking confirmation. A retry after a dropped connection is ordinary on a
 * mobile network, so a repeat call returns the existing receipt with
 * `alreadyConfirmed: true` rather than an error — the caller gets the same
 * answer either way.
 *
 * NO REAL MONEY MOVES HERE. Nothing in this function contacts a payment
 * provider. A real provider would confirm through a signed webhook instead,
 * because a request from the payer's browser proves nothing about whether funds
 * actually moved — see `acceptsClientConfirmation` in _shared/payment-provider.ts.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { callerIp, fail, failFromRpc, handleOptions, ok } from '../_shared/http.ts';
import { resolveProvider } from '../_shared/payment-provider.ts';

interface RequestBody {
  reference?: string;
  token?: string;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return fail('VALIDATION_ERROR', 'Use POST.', 405);

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return fail('VALIDATION_ERROR', 'Expected a JSON body.');
  }

  const reference = body.reference?.trim();
  const token = body.token?.trim();

  if (!reference || !token) return fail('INVALID_QR', 'This payment link is incomplete.');

  // Refuse to confirm from a browser unless the configured provider allows it.
  // With a real provider wired this guard is what stops the test flow being
  // used as a way to mark a payment paid without money moving.
  const webBaseUrl = Deno.env.get('WEB_PAYMENT_BASE_URL') ?? 'http://127.0.0.1:8090';
  let provider;
  try {
    provider = resolveProvider(Deno.env.get('PAYMENT_PROVIDER'), webBaseUrl);
  } catch (error) {
    console.error(error);
    return fail('INTERNAL_ERROR');
  }

  if (!provider.acceptsClientConfirmation) {
    console.error(`Provider ${provider.name} does not accept client confirmation.`);
    return fail('FORBIDDEN', 'This payment must be confirmed by the payment provider.');
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  );

  const { data, error } = await supabase.rpc('confirm_test_payment', {
    p_reference: reference,
    p_token: token,
    p_ip_address: callerIp(request),
  });

  if (error) return failFromRpc(error);

  return ok(data);
});
