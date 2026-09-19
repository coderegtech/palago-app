/**
 * get-payment
 *
 * Returns the safe payment summary the public payment page renders.
 *
 * PUBLIC (verify_jwt = false): the page opens in a browser with no PalaGo
 * session, reached by scanning a QR. Authorisation is the token from that QR,
 * which `get_public_payment` requires and matches server-side.
 *
 * The response is deliberately narrow. It never includes the token itself, user
 * ids, or anything about other bookings, and a wrong token returns NOT_FOUND
 * rather than "bad token" so a reference cannot be probed.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { fail, failFromRpc, handleOptions, ok, serve } from '../_shared/http.ts';

interface RequestBody {
  reference?: string;
  token?: string;
}

serve('get-payment', async (request) => {
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  );

  const { data, error } = await supabase.rpc('get_public_payment', {
    p_reference: reference,
    p_token: token,
  });

  if (error) return failFromRpc(error);
  if (!data) return fail('NOT_FOUND');

  return ok(data);
});
