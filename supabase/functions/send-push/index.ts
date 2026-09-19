/**
 * send-push
 *
 * Delivers one notification to the devices its owner has registered.
 *
 * Called by the `notifications_deliver_push` trigger through pg_net, not by the
 * app — which is why it runs with `verify_jwt = false`: the database has no
 * PalaGo session to present. Authorisation is the shared secret in
 * `x-palago-push-secret`, compared in constant time. Without that check anyone
 * who learned the URL could push arbitrary text to a passenger's lock screen,
 * and a message that appears to come from their bus operator is worth faking.
 *
 * The function reads with the service role because it is delivering somebody
 * else's notification to somebody else's devices; there is no user session to
 * act as. It therefore reads exactly two things — the notification named in the
 * request, and that notification's owner's tokens — and never takes a user id,
 * a token or any text from the caller.
 *
 * Failure to deliver is reported in the response and logged, never retried in a
 * loop. The row in `notifications` is the record that the event happened; the
 * app's own feed shows it whether or not the push arrived.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { fail, handleOptions, ok, serve } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Expo caps a single request at 100 messages. */
const EXPO_BATCH_SIZE = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Constant-time comparison. `===` on secrets leaks their length and their
 * matching prefix through timing, which is enough to recover one over many
 * attempts against an endpoint that anyone can reach.
 */
function secretMatches(given: string, expected: string): boolean {
  if (expected.length === 0) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** Expo's own format check, so a junk row cannot poison a whole batch. */
function looksLikeExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

serve('send-push', async (request) => {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return fail('VALIDATION_ERROR', 'Use POST.', 405);

  const expectedSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '';
  if (!expectedSecret) {
    // Refuse rather than run unauthenticated. An open push endpoint is worse
    // than no push.
    log.error('push_webhook_secret_missing');
    return fail('INTERNAL_ERROR');
  }

  if (!secretMatches(request.headers.get('x-palago-push-secret') ?? '', expectedSecret)) {
    return fail('UNAUTHORIZED');
  }

  let body: { notificationId?: string };
  try {
    body = await request.json();
  } catch {
    return fail('VALIDATION_ERROR', 'Expected a JSON body.');
  }

  if (!body.notificationId) return fail('VALIDATION_ERROR', 'notificationId is required.');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: notification, error: notificationError } = await supabase
    .from('notifications')
    .select('id, user_id, type, title, message, data')
    .eq('id', body.notificationId)
    .maybeSingle();

  if (notificationError) {
    log.error('notification_read_failed', { message: notificationError.message });
    return fail('INTERNAL_ERROR');
  }
  if (!notification) return fail('NOT_FOUND');

  const { data: tokens, error: tokensError } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', notification.user_id);

  if (tokensError) {
    log.error('push_tokens_read_failed', { message: tokensError.message });
    return fail('INTERNAL_ERROR');
  }

  const recipients = (tokens ?? [])
    .map((row) => row.token as string)
    .filter(looksLikeExpoToken);

  // Nobody has registered a device. That is a normal state — web-only users,
  // or someone who declined the permission — not an error.
  if (recipients.length === 0) {
    return ok({ notificationId: notification.id, sent: 0, failed: 0, devices: 0 });
  }

  let sent = 0;
  let failed = 0;
  const staleTokens: string[] = [];

  for (const batch of chunk(recipients, EXPO_BATCH_SIZE)) {
    const messages = batch.map((token) => ({
      to: token,
      title: notification.title,
      body: notification.message,
      // Carries what the app needs to open the right screen; the same shape the
      // in-app feed routes on, so a tapped push and a tapped row agree.
      data: { notificationId: notification.id, type: notification.type, ...(notification.data ?? {}) },
      sound: 'default',
      priority: 'high',
      channelId: 'default',
    }));

    let tickets: ExpoTicket[] = [];
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });

      if (!response.ok) {
        log.error('expo_push_batch_rejected', {
          status: response.status,
          body: await response.text(),
          size: batch.length,
        });
        failed += batch.length;
        continue;
      }

      const payload = (await response.json()) as { data?: ExpoTicket[] };
      tickets = payload.data ?? [];
    } catch (error) {
      log.error('expo_push_request_failed', { error, size: batch.length });
      failed += batch.length;
      continue;
    }

    tickets.forEach((ticket, index) => {
      if (ticket.status === 'ok') {
        sent += 1;
        return;
      }

      failed += 1;
      log.warn('expo_push_ticket_error', { message: ticket.message, detail: ticket.details?.error });

      // The app was uninstalled or the token was reissued. Keeping it means
      // failing forever, so drop it; the device re-registers on next sign-in.
      if (ticket.details?.error === 'DeviceNotRegistered') staleTokens.push(batch[index]);
    });
  }

  if (staleTokens.length > 0) {
    const { error } = await supabase.from('push_tokens').delete().in('token', staleTokens);
    if (error) log.error('stale_push_tokens_not_removed', { message: error.message });
  }

  // An Expo ticket only means Expo accepted the message. Whether it reached the
  // handset is a receipt, checked later; this response does not claim delivery.
  return ok({
    notificationId: notification.id,
    devices: recipients.length,
    sent,
    failed,
    removedTokens: staleTokens.length,
  });
});
