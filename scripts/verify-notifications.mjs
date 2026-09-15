/**
 * Notifications — the feed, its realtime transport, and the device register.
 *
 *   pnpm db:verify:notifications
 *
 * The feed's whole value is that a passenger can believe it. Every row in it
 * claims something happened: a payment cleared, a seat was assigned, a ticket
 * was scanned. So the checks here are mostly about what a client *cannot* do.
 *
 *   - nobody can create a notification. Not a passenger, not an operator, not
 *     an admin. If a client could insert one, "Payment received" would be worth
 *     nothing, and a phishing message could be planted in the one place in the
 *     app a passenger is told to trust.
 *   - nobody can rewrite or delete one. `read_at` is the only writable column,
 *     and only on your own rows — so the title and the message a passenger reads
 *     are the ones the server wrote.
 *   - a real event really does produce one: a confirmed payment lands in the
 *     feed, unread, addressed to the passenger who paid.
 *   - realtime carries it. `notifications` is in the publication, so the row
 *     arrives on an open subscription — this is asserted by *receiving* one, not
 *     by reading a catalogue, because a subscription that never fires looks
 *     exactly like a quiet app.
 *   - the device register is private and moves with the person signed in: a
 *     token registered by a second user stops belonging to the first, which is
 *     what stops a shared handset delivering a stranger's trip alerts.
 *   - `app_settings` is readable by nobody, including an admin.
 *
 * What this cannot prove, and does not claim: that a push notification arrives
 * on a handset. That needs a real device, a development build with push
 * credentials, and a deployed `send-push` function with PUSH_WEBHOOK_SECRET
 * set. Everything up to the point of handing the message to Expo is covered
 * here and in the function's own code; the last hop is not.
 *
 * Requires `supabase start`, and the Edge Functions served (`pnpm
 * functions:serve`) for the payment scenario.
 */

import { createClient } from '@supabase/supabase-js';
import { loadVerifyEnv } from './_verify-env.mjs';
import { makeInvoke } from './_verify-invoke.mjs';

const { url: URL_, key: KEY } = loadVerifyEnv();
const PASSWORD = 'PalawanGo2026';

const client = () => createClient(URL_, KEY, { auth: { persistSession: false } });

async function signIn(email) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return { supabase, email, userId: data.user.id, accessToken: data.session.access_token };
}

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const invoke = makeInvoke(URL_, KEY);

const passenger = await signIn('passenger@palago.test');
const other = await signIn('passenger2@palago.test');
const operator = await signIn('operator@palago.test');
const admin = await signIn('admin@palago.test');
const anon = client();

// ---------------------------------------------------------------------------
console.log('\nScenario 1: only the server writes the feed');
// ---------------------------------------------------------------------------

const forged = {
  user_id: passenger.userId,
  type: 'PAYMENT_CONFIRMED',
  title: 'Payment received',
  message: 'Tap here to claim your refund at palag0.example',
};

for (const who of [passenger, other, operator, admin]) {
  const { error } = await who.supabase.from('notifications').insert(forged);
  check(`${who.email.split('@')[0]} cannot plant a notification`, error !== null, 'insert succeeded');
}

const anonInsert = await anon.from('notifications').insert(forged);
check('an anonymous caller cannot either', anonInsert.error !== null);

// The insert must not merely error — it must leave nothing behind.
const { data: planted } = await passenger.supabase
  .from('notifications')
  .select('id')
  .eq('message', forged.message);
check('and nothing was written', (planted ?? []).length === 0, `${planted?.length} rows`);

// ---------------------------------------------------------------------------
console.log('\nScenario 2: a real event produces one');
// ---------------------------------------------------------------------------

const { data: trips } = await passenger.supabase
  .from('trips')
  .select('id, fare')
  .eq('status', 'SCHEDULED')
  .order('departure_date')
  .limit(1);

const { data: newBooking, error: bookingError } = await passenger.supabase.rpc('create_booking', {
  p_trip_id: trips[0].id,
  p_passengers: [{ name: 'Ana Reyes', phone: '09171234567', email: null, type: 'ADULT' }],
});
if (bookingError) throw new Error(`create_booking failed: ${bookingError.message}`);

const created = await invoke(
  'create-test-payment',
  { bookingId: newBooking.bookingId },
  passenger.accessToken,
);
if (created.body?.success !== true) {
  throw new Error(
    `create-test-payment failed (${created.status}). Is \`pnpm functions:serve\` running? ${JSON.stringify(created.body)}`,
  );
}
const payment = created.body.data;
const paymentToken = new URL(payment.paymentUrl).searchParams.get('t');

// Subscribe BEFORE the event, or "it arrived" would just mean "it was already
// in the table".
const channelUser = client();
await channelUser.auth.signInWithPassword({ email: passenger.email, password: PASSWORD });

const liveRows = [];
const channel = channelUser
  .channel(`verify-notifications:${passenger.userId}`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${passenger.userId}`,
    },
    (event) => liveRows.push(event.new),
  );

const subscribed = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('TIMED_OUT'), 10_000);
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      clearTimeout(timer);
      resolve(status);
    }
  });
});
check('a passenger can subscribe to their own notifications', subscribed === 'SUBSCRIBED', subscribed);

// SUBSCRIBED is an acknowledgement from the channel, not a guarantee that the
// subscription is yet visible to the process reading the write-ahead log. A row
// written inside that window is missed outright — Realtime does not replay — so
// a check that fires the event the instant the ack arrives is testing the race,
// not the feature.
//
// This was worth chasing rather than papering over: on its own the suite passed
// every time, and after the other eleven had run it failed every time, which
// looks exactly like a missing publication. It is not. The window simply widens
// when the replication stream is busy, and the same race is why an app that
// subscribes and immediately acts on its own write can appear to lose an event.
await new Promise((r) => setTimeout(r, 3000));

const confirmed = await invoke('confirm-test-payment', {
  reference: payment.reference,
  token: paymentToken,
});
check('the test payment is confirmed', confirmed.body?.success === true, JSON.stringify(confirmed.body));

// Realtime is a separate service reading the write-ahead log, so this is a
// wait, not a tick. The window is generous on purpose: run on its own the row
// lands in well under a second, but `db:verify:all` puts eleven suites' worth
// of changes through the same replication stream first — `bookings`,
// `payments`, `trips` and `bus_locations` are all in the publication — and a
// backlog delays everything behind it. The elapsed time is reported either way,
// so a slow arrival reads as lag rather than as a missing publication.
const startedWaiting = Date.now();
const deadline = startedWaiting + 60_000;
while (liveRows.length === 0 && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 250));
}
const waited = Date.now() - startedWaiting;

check(
  `the notification arrives over realtime, unprompted (${(waited / 1000).toFixed(1)}s)`,
  liveRows.some((row) => row.type === 'PAYMENT_CONFIRMED'),
  liveRows.length === 0
    ? 'nothing arrived in 60s — is `notifications` in the supabase_realtime publication?'
    : liveRows.map((r) => r.type).join(', '),
);

check(
  'it carries the whole row, not just an id',
  liveRows[0]?.title !== undefined && liveRows[0]?.message !== undefined,
  JSON.stringify(liveRows[0] ?? null),
);

await channelUser.removeChannel(channel);

const { data: feed } = await passenger.supabase
  .from('notifications')
  .select('id, type, title, message, data, read_at')
  .eq('type', 'PAYMENT_CONFIRMED')
  .order('created_at', { ascending: false })
  .limit(1);

const fresh = feed?.[0];
check('and it is in the feed', Boolean(fresh), 'no PAYMENT_CONFIRMED row');
check('unread', fresh?.read_at === null, String(fresh?.read_at));
check(
  'with the booking it is about, so tapping it can go somewhere',
  typeof fresh?.data?.bookingId === 'string',
  JSON.stringify(fresh?.data),
);

// ---------------------------------------------------------------------------
console.log('\nScenario 3: the feed is private and read-only');
// ---------------------------------------------------------------------------

const { data: otherSees } = await other.supabase
  .from('notifications')
  .select('id')
  .eq('id', fresh.id);
check("another passenger cannot see it", (otherSees ?? []).length === 0, `${otherSees?.length} rows`);

const { data: operatorSees } = await operator.supabase
  .from('notifications')
  .select('id')
  .eq('id', fresh.id);
check('the operator cannot see it either', (operatorSees ?? []).length === 0);

const { data: anonSees } = await anon.from('notifications').select('id').eq('id', fresh.id);
check('nor an anonymous caller', (anonSees ?? []).length === 0);

// The message is the thing a passenger acts on. If it can be rewritten after
// the fact, the feed stops being a record.
const rewrite = await passenger.supabase
  .from('notifications')
  .update({ message: 'Send ₱500 to this number to confirm your seat.' })
  .eq('id', fresh.id)
  .select();
check(
  'the owner cannot rewrite the message',
  rewrite.error !== null || (rewrite.data ?? []).length === 0,
  JSON.stringify(rewrite.data),
);

const { data: unchanged } = await passenger.supabase
  .from('notifications')
  .select('message')
  .eq('id', fresh.id)
  .single();
check('and the text still says what the server wrote', unchanged.message === fresh.message);

const retype = await passenger.supabase
  .from('notifications')
  .update({ type: 'SOS' })
  .eq('id', fresh.id)
  .select();
check(
  'nor change its type',
  retype.error !== null || (retype.data ?? []).length === 0,
  JSON.stringify(retype.data),
);

const reassign = await passenger.supabase
  .from('notifications')
  .update({ user_id: other.userId })
  .eq('id', fresh.id)
  .select();
check(
  'nor hand it to somebody else',
  reassign.error !== null || (reassign.data ?? []).length === 0,
  JSON.stringify(reassign.data),
);

const del = await passenger.supabase.from('notifications').delete().eq('id', fresh.id).select();
check('nor delete it', del.error !== null || (del.data ?? []).length === 0, JSON.stringify(del.data));

const { data: stillThere } = await passenger.supabase
  .from('notifications')
  .select('id')
  .eq('id', fresh.id);
check('the row survived all of that', (stillThere ?? []).length === 1);

// read_at is the one exception, and the reason the column grant exists.
const markRead = await passenger.supabase
  .from('notifications')
  .update({ read_at: new Date().toISOString() })
  .eq('id', fresh.id)
  .select();
check(
  'but the owner CAN mark it read',
  markRead.error === null && (markRead.data ?? []).length === 1,
  markRead.error?.message,
);

// ---------------------------------------------------------------------------
console.log('\nScenario 4: marking somebody else read');
// ---------------------------------------------------------------------------

const { data: othersOwn } = await other.supabase
  .from('notifications')
  .select('id, read_at')
  .is('read_at', null)
  .limit(1);

if ((othersOwn ?? []).length === 0) {
  console.log('  (skipped: the second passenger has no unread notification to attack)');
} else {
  const victim = othersOwn[0];
  const attack = await passenger.supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', victim.id)
    .select();
  check(
    'a passenger cannot mark another passenger read',
    attack.error !== null || (attack.data ?? []).length === 0,
    JSON.stringify(attack.data),
  );

  const { data: after } = await other.supabase
    .from('notifications')
    .select('read_at')
    .eq('id', victim.id)
    .single();
  check('and it is still unread', after.read_at === null, String(after.read_at));

  // "Mark all as read" sends no user filter — the policy is the filter. Prove
  // that is actually true rather than trusting the comment that says so.
  await passenger.supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);

  const { data: afterAll } = await other.supabase
    .from('notifications')
    .select('read_at')
    .eq('id', victim.id)
    .single();
  check(
    'and "mark all as read" does not reach across accounts',
    afterAll.read_at === null,
    String(afterAll.read_at),
  );
}

// ---------------------------------------------------------------------------
console.log('\nScenario 5: registering a device');
// ---------------------------------------------------------------------------

const TOKEN = `ExponentPushToken[verify-${Date.now()}]`;

const register = await passenger.supabase.rpc('register_push_token', {
  p_token: TOKEN,
  p_platform: 'android',
  p_device_name: 'Verify suite',
});
check('a passenger can register a device', register.error === null, register.error?.message);

const { data: mine } = await passenger.supabase
  .from('push_tokens')
  .select('token, platform, device_name')
  .eq('token', TOKEN);
check('and read it back', (mine ?? []).length === 1, `${mine?.length} rows`);
check('with the platform it sent', mine?.[0]?.platform === 'android', mine?.[0]?.platform);

const again = await passenger.supabase.rpc('register_push_token', {
  p_token: TOKEN,
  p_platform: 'android',
  p_device_name: 'Verify suite',
});
check('registering the same device twice is not an error', again.error === null, again.error?.message);

const { data: notDuplicated } = await passenger.supabase
  .from('push_tokens')
  .select('id')
  .eq('token', TOKEN);
check('and does not add a second row', (notDuplicated ?? []).length === 1, `${notDuplicated?.length}`);

const badPlatform = await passenger.supabase.rpc('register_push_token', {
  p_token: 'ExponentPushToken[nonsense]',
  p_platform: 'blackberry',
  p_device_name: null,
});
check(
  'an unknown platform is refused',
  badPlatform.error?.message === 'VALIDATION_ERROR',
  badPlatform.error?.message,
);

const blank = await passenger.supabase.rpc('register_push_token', {
  p_token: '   ',
  p_platform: 'ios',
  p_device_name: null,
});
check('a blank token is refused', blank.error?.message === 'VALIDATION_ERROR', blank.error?.message);

const anonRegister = await anon.rpc('register_push_token', {
  p_token: 'ExponentPushToken[anonymous]',
  p_platform: 'ios',
  p_device_name: null,
});
check('an anonymous caller cannot register one', anonRegister.error !== null);

// ---------------------------------------------------------------------------
console.log('\nScenario 6: whose device is it');
// ---------------------------------------------------------------------------

const { data: otherSeesDevice } = await other.supabase
  .from('push_tokens')
  .select('token')
  .eq('token', TOKEN);
check("another passenger cannot see somebody's device", (otherSeesDevice ?? []).length === 0);

// Deliberate: a device list says where a person can be reached. An operator has
// no business with it, and neither does an admin.
const { data: operatorSeesDevice } = await operator.supabase
  .from('push_tokens')
  .select('token')
  .eq('token', TOKEN);
check('an operator cannot see it', (operatorSeesDevice ?? []).length === 0);

const { data: adminSeesDevice } = await admin.supabase
  .from('push_tokens')
  .select('token')
  .eq('token', TOKEN);
check('an admin cannot see it either', (adminSeesDevice ?? []).length === 0, `${adminSeesDevice?.length} rows`);

const directInsert = await other.supabase.from('push_tokens').insert({
  user_id: other.userId,
  token: `ExponentPushToken[direct-${Date.now()}]`,
  platform: 'ios',
});
check('nobody can INSERT a device row directly', directInsert.error !== null);

const directUpdate = await passenger.supabase
  .from('push_tokens')
  .update({ platform: 'ios' })
  .eq('token', TOKEN)
  .select();
check(
  'nor UPDATE one',
  directUpdate.error !== null || (directUpdate.data ?? []).length === 0,
  JSON.stringify(directUpdate.data),
);

const directDelete = await passenger.supabase
  .from('push_tokens')
  .delete()
  .eq('token', TOKEN)
  .select();
check(
  'nor DELETE one',
  directDelete.error !== null || (directDelete.data ?? []).length === 0,
  JSON.stringify(directDelete.data),
);

// The property that matters on a shared handset: registering hands the device
// over, rather than leaving the previous passenger subscribed to it.
const handover = await other.supabase.rpc('register_push_token', {
  p_token: TOKEN,
  p_platform: 'android',
  p_device_name: 'Verify suite',
});
check('a second person can register the same handset', handover.error === null, handover.error?.message);

const { data: firstOwnerNow } = await passenger.supabase
  .from('push_tokens')
  .select('token')
  .eq('token', TOKEN);
check(
  'and the previous owner no longer has it',
  (firstOwnerNow ?? []).length === 0,
  `${firstOwnerNow?.length} rows`,
);

const { data: newOwnerNow } = await other.supabase
  .from('push_tokens')
  .select('token')
  .eq('token', TOKEN);
check('the new owner does', (newOwnerNow ?? []).length === 1);

// Removing somebody else's device would be a way to silence their trip alerts.
const stealRemoval = await passenger.supabase.rpc('remove_push_token', { p_token: TOKEN });
check(
  'removing a device you do not own removes nothing',
  stealRemoval.data?.removed === 0,
  JSON.stringify(stealRemoval.data ?? stealRemoval.error?.message),
);

const removal = await other.supabase.rpc('remove_push_token', { p_token: TOKEN });
check('the owner can forget their own', removal.data?.removed === 1, JSON.stringify(removal.data));

const { data: gone } = await other.supabase.from('push_tokens').select('token').eq('token', TOKEN);
check('and it is gone', (gone ?? []).length === 0);

// ---------------------------------------------------------------------------
console.log('\nScenario 7: the delivery configuration is not client-readable');
// ---------------------------------------------------------------------------

for (const who of [passenger, other, operator, admin]) {
  const { data, error } = await who.supabase.from('app_settings').select('key, value');
  check(
    `${who.email.split('@')[0]} cannot read app_settings`,
    error !== null || (data ?? []).length === 0,
    JSON.stringify(data),
  );
}

const anonSettings = await anon.from('app_settings').select('key, value');
check(
  'nor an anonymous caller',
  anonSettings.error !== null || (anonSettings.data ?? []).length === 0,
  JSON.stringify(anonSettings.data),
);

const writeSettings = await admin.supabase
  .from('app_settings')
  .update({ value: 'https://attacker.example/collect' })
  .eq('key', 'push_webhook_url')
  .select();
check(
  'and not even an admin can point the push webhook somewhere else',
  writeSettings.error !== null || (writeSettings.data ?? []).length === 0,
  JSON.stringify(writeSettings.data),
);

// ---------------------------------------------------------------------------
console.log('\nScenario 8: send-push refuses callers without the secret');
// ---------------------------------------------------------------------------

const unsigned = await fetch(`${URL_}/functions/v1/send-push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ notificationId: fresh.id }),
});
const unsignedBody = await unsigned.json().catch(() => null);
check(
  'a caller with no shared secret is refused',
  unsigned.status === 401 || unsigned.status === 500,
  `${unsigned.status} ${JSON.stringify(unsignedBody)}`,
);

const wrongSecret = await fetch(`${URL_}/functions/v1/send-push`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: KEY,
    'x-palago-push-secret': 'not-the-secret',
  },
  body: JSON.stringify({ notificationId: fresh.id }),
});
check(
  'and so is one with the wrong secret',
  wrongSecret.status === 401 || wrongSecret.status === 500,
  String(wrongSecret.status),
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
