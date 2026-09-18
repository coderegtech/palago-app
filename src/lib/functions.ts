/**
 * Calling one of our own Edge Functions as the signed-in user.
 *
 * Every function answers with the same envelope (`_shared/http.ts`):
 * `{ success: true, data }` or `{ success: false, code, message }`. This turns
 * that into a value or an `AppError`, so a screen handles a refusal from a
 * function exactly as it handles one from an RPC.
 *
 * `fetch` rather than `supabase.functions.invoke`: invoke collapses every
 * non-2xx into a generic FunctionsHttpError and hides the body, which is where
 * the error code the screen needs actually lives.
 */

import { ErrorCode } from '@/constants/errors';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

interface FunctionEnvelope<T> {
  success: boolean;
  data?: T;
  code?: string;
  message?: string;
}

export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const accessToken = session.session?.access_token;
  if (!accessToken) throw new AppError(ErrorCode.UNAUTHORIZED);

  let envelope: FunctionEnvelope<T>;
  try {
    const response = await fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.supabasePublishableKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
    envelope = (await response.json()) as FunctionEnvelope<T>;
  } catch {
    throw new AppError(ErrorCode.NETWORK_ERROR);
  }

  if (!envelope.success) {
    const code = (envelope.code ?? ErrorCode.INTERNAL_ERROR) as ErrorCode;
    throw new AppError(code, envelope.message);
  }

  return envelope.data as T;
}
