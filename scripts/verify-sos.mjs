/**
 * Emergency assistance — verified against the local stack with real signed-in
 * roles, through the ordinary publishable key. No service-role key anywhere:
 * the point is to prove what an actual client can and cannot do.
 *
 *   pnpm db:verify:sos
 *
 * What this exists to prove, none of which a unit test can show:
 *
 *   - a passenger can raise an alert, and a second press while it is still open
 *     returns the SAME alert rather than raising a second emergency
 *   - the table has no client write path at all: nobody can INSERT, UPDATE or
 *     DELETE an incident directly, including the passenger who raised it and
 *     the operator responding to it
 *   - the operator running the trip sees the alert; a RIVAL operator does not,
 *     and cannot acknowledge or resolve it
 *   - a passenger cannot see or touch someone else's alert
 *   - an anonymous caller sees nothing
 *   - the status machine is server-controlled and idempotent: acknowledging
 *     twice changes nothing the second time, and a resolved alert cannot be
 *     walked backwards
 *   - the passenger may cancel their own false alarm, but NOT once a responder
 *     is already on the way
 *
 * Re-runnable: it closes any alert it finds open before it starts, and closes
 * the ones it raises. Nothing here deletes — an alert is a record, and there is
 * no DELETE path for any client, which is itself one of the checks.
 *
 * Requires `supabase start`.
 */

import { createClient } from '@supabase/supabase-js';
import { loadVerifyEnv } from './_verify-env.mjs';

const { url: URL_, key: KEY } = loadVerifyEnv();
const PASSWORD = 'PalawanGo2026';

const client = () => createClient(URL_, KEY, { auth: { persistSession: false } });

async function signIn(email) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return { supabase, email, userId: data.user.id };
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

/** Somewhere on the Puerto Princesa–El Nido road. */
const HERE = { latitude: 10.3457, longitude: 118.9978 };

const passenger = await signIn('passenger@palago.test');
const other = await signIn('passenger2@palago.test');
const cherry = await signIn('operator@palago.test');
const roro = await signIn('roro@palago.test');
const admin = await signIn('admin@palago.test');
const anon = client();

/**
 * Close anything already open, so the one-open-per-user index does not make a
 * re-run look like a failure. An admin passes `can_manage_sos` outright.
 */
async function closeOpenFor(user) {
  const { data } = await user.supabase
    .from('sos_incidents')
    .select('id')
    .in('status', ['ACTIVE', 'ACKNOWLEDGED', 'RESPONDING']);

  for (const row of data ?? []) {
    await admin.supabase.rpc('resolve_sos', { p_sos_id: row.id, p_note: 'Closed by test setup.' });
  }
}

await closeOpenFor(passenger);
await closeOpenFor(other);

/**
 * The trip the passenger is actually travelling on, so the alert has an
 * operator to be scoped to. Read as the passenger — their own booking.
 */
const { data: booking } = await passenger.supabase
  .from('bookings')
  .select('id, trip_id, status')
  .in('status', ['CONFIRMED', 'CHECKED_IN', 'BOARDED', 'ON_TRIP'])
  .limit(1)
  .maybeSingle();

// ---------------------------------------------------------------------------
console.log('\nRaising an alert');
// ---------------------------------------------------------------------------

const raised = await passenger.supabase.rpc('trigger_sos', {
  p_latitude: HERE.latitude,
  p_longitude: HERE.longitude,
  p_booking_id: booking?.id ?? null,
});

check('a passenger can raise an alert', !raised.error, raised.error?.message);
check('it comes back ACTIVE', raised.data?.status === 'ACTIVE', JSON.stringify(raised.data));
check('and it is not flagged as a repeat', raised.data?.alreadyOpen === false);
check(
  'the trip is resolved server-side from the booking',
  booking ? raised.data?.tripId === booking.trip_id : raised.data?.tripId === null,
  `${raised.data?.tripId} vs ${booking?.trip_id}`,
);

const incidentId = raised.data?.id;

const again = await passenger.supabase.rpc('trigger_sos', {
  p_latitude: HERE.latitude,
  p_longitude: HERE.longitude,
});
check('pressing again while it is open does not raise a second', again.data?.id === incidentId);
check('and says so', again.data?.alreadyOpen === true);

const { data: openRows } = await passenger.supabase
  .from('sos_incidents')
  .select('id')
  .in('status', ['ACTIVE', 'ACKNOWLEDGED', 'RESPONDING']);
check('exactly one open incident exists for them', openRows?.length === 1, String(openRows?.length));

const badCoords = await passenger.supabase.rpc('trigger_sos', {
  p_latitude: 999,
  p_longitude: 0,
});
check(
  'impossible coordinates are refused',
  badCoords.error?.message === 'VALIDATION_ERROR',
  badCoords.error?.message,
);

if (booking) {
  const notMine = await other.supabase.rpc('trigger_sos', {
    p_latitude: HERE.latitude,
    p_longitude: HERE.longitude,
    p_booking_id: booking.id,
  });
  check(
    "a passenger cannot attach their alert to someone else's booking",
    notMine.error?.message === 'FORBIDDEN',
    notMine.error?.message,
  );
}

const anonRaise = await anon.rpc('trigger_sos', {
  p_latitude: HERE.latitude,
  p_longitude: HERE.longitude,
});
check('an anonymous caller cannot raise one', Boolean(anonRaise.error), anonRaise.error?.message);

// ---------------------------------------------------------------------------
console.log('\nThe table has no client write path');
// ---------------------------------------------------------------------------

const directInsert = await passenger.supabase
  .from('sos_incidents')
  .insert({ user_id: passenger.userId, latitude: 1, longitude: 1 });
check('a passenger cannot INSERT an incident directly', Boolean(directInsert.error));

await passenger.supabase.from('sos_incidents').update({ status: 'RESOLVED' }).eq('id', incidentId);
const { data: afterSelfResolve } = await passenger.supabase
  .from('sos_incidents')
  .select('status')
  .eq('id', incidentId)
  .single();
check(
  'a passenger cannot mark their own alert resolved',
  afterSelfResolve?.status === 'ACTIVE',
  afterSelfResolve?.status,
);

await cherry.supabase.from('sos_incidents').update({ status: 'RESOLVED' }).eq('id', incidentId);
const { data: afterOperatorUpdate } = await cherry.supabase
  .from('sos_incidents')
  .select('status')
  .eq('id', incidentId)
  .single();
check(
  'the responding operator cannot UPDATE the row either',
  afterOperatorUpdate?.status === 'ACTIVE',
  afterOperatorUpdate?.status,
);

await passenger.supabase.from('sos_incidents').delete().eq('id', incidentId);
const { data: stillThere } = await passenger.supabase
  .from('sos_incidents')
  .select('id')
  .eq('id', incidentId);
check('and nobody can DELETE one — an alert is a record', stillThere?.length === 1);

// ---------------------------------------------------------------------------
console.log('\nWho can see it');
// ---------------------------------------------------------------------------

const mine = await passenger.supabase.from('sos_incidents').select('id').eq('id', incidentId);
check('the passenger sees their own alert', mine.data?.length === 1);

const cherrySees = await cherry.supabase.from('sos_incidents').select('id').eq('id', incidentId);
check(
  'the operator running the trip sees it',
  cherrySees.data?.length === 1,
  JSON.stringify(cherrySees.data),
);

const roroSees = await roro.supabase.from('sos_incidents').select('id').eq('id', incidentId);
check('a rival operator sees nothing', roroSees.data?.length === 0, JSON.stringify(roroSees.data));

const otherSees = await other.supabase.from('sos_incidents').select('id').eq('id', incidentId);
check('another passenger sees nothing', otherSees.data?.length === 0);

const anonSees = await anon.from('sos_incidents').select('id');
check(
  'an anonymous caller sees nothing',
  (anonSees.data?.length ?? 0) === 0,
  JSON.stringify(anonSees.data),
);

// ---------------------------------------------------------------------------
console.log('\nWho is told');
// ---------------------------------------------------------------------------
//
// An alert only the passenger was notified of reached nobody who could help:
// until 20260919000038 the operator, its driver and its crew got nothing, and
// saw the alert only if the dashboard happened to be open.

async function sosNotesFor(user) {
  const { data } = await user.supabase
    .from('notifications')
    .select('title, message, data')
    .eq('type', 'SOS')
    // Their OWN notifications: an admin may read everyone's.
    .eq('user_id', user.userId);
  return (data ?? []).filter((n) => n.data?.sosId === incidentId);
}

const cherryNotes = await sosNotesFor(cherry);
check(
  'the operator running the trip is notified',
  booking ? cherryNotes.length >= 1 : cherryNotes.length === 0,
  String(cherryNotes.length),
);
check('once — the repeat press did not notify again', cherryNotes.length <= 1, String(cherryNotes.length));
check(
  'with the trip and the passenger in the message',
  !booking || (/EMERGENCY/.test(cherryNotes[0]?.title ?? '') && /raised an SOS/.test(cherryNotes[0]?.message ?? '')),
  JSON.stringify(cherryNotes[0]),
);

const adminNotes = await sosNotesFor(admin);
check('the admins are notified', adminNotes.length === 1, String(adminNotes.length));

// The crew rostered on the trip — resolved from the roster, never hardcoded
// (AGENTS.md: which driver is on a seeded trip is the allocator's choice).
let crewMember = null;
if (booking) {
  const { data: roster } = await admin.supabase
    .from('trip_assignments')
    .select('status, drivers(user_id)')
    .eq('trip_id', booking.trip_id)
    .neq('status', 'CANCELLED');
  const driverUserId = roster?.find((r) => r.drivers?.user_id)?.drivers?.user_id;
  if (driverUserId) {
    const { data: driverProfile } = await admin.supabase
      .from('profiles')
      .select('email')
      .eq('id', driverUserId)
      .single();
    crewMember = await signIn(driverProfile.email);
  }
}
check('the seed rosters a driver with an account on that trip', !booking || crewMember !== null);
if (crewMember) {
  const crewNotes = await sosNotesFor(crewMember);
  check('the driver on that trip is notified', crewNotes.length === 1, String(crewNotes.length));
}

check('a rival operator is not notified', (await sosNotesFor(roro)).length === 0);
check('another passenger is not notified', (await sosNotesFor(other)).length === 0);

const { data: passengerNote } = await passenger.supabase
  .from('notifications')
  .select('message')
  .eq('type', 'SOS')
  .order('created_at', { ascending: false })
  .limit(1)
  .single();
check(
  'the passenger is not promised help nobody has offered yet',
  !/arranged|on the way|coming/i.test(passengerNote?.message ?? ''),
  passengerNote?.message,
);

// ---------------------------------------------------------------------------
console.log('\nWhat a responder sees');
// ---------------------------------------------------------------------------

const DETAIL = 'id, passenger_name, passenger_phone, trip_number, bus_number, route_label';

const cherryDetail = await cherry.supabase
  .from('sos_incident_details')
  .select(DETAIL)
  .eq('id', incidentId);
check(
  'the operator gets the passenger’s name with the alert',
  !booking || Boolean(cherryDetail.data?.[0]?.passenger_name),
  cherryDetail.error?.message ?? JSON.stringify(cherryDetail.data),
);
check(
  'and the trip and coach',
  !booking ||
    (Boolean(cherryDetail.data?.[0]?.trip_number) && Boolean(cherryDetail.data?.[0]?.bus_number)),
  JSON.stringify(cherryDetail.data),
);

if (crewMember) {
  const crewDetail = await crewMember.supabase
    .from('sos_incident_details')
    .select('id')
    .eq('id', incidentId);
  check('the driver on the trip sees it too', crewDetail.data?.length === 1, crewDetail.error?.message);
}

const adminDetail = await admin.supabase.from('sos_incident_details').select('id').eq('id', incidentId);
check('the admin sees it', adminDetail.data?.length === 1, adminDetail.error?.message);

const roroDetail = await roro.supabase.from('sos_incident_details').select(DETAIL);
check(
  'a rival operator sees no one’s details',
  !(roroDetail.data ?? []).some((r) => r.id === incidentId),
  JSON.stringify(roroDetail.data),
);
const otherDetail = await other.supabase.from('sos_incident_details').select(DETAIL);
check(
  'another passenger sees no one’s details',
  (otherDetail.data?.length ?? 0) === 0,
  JSON.stringify(otherDetail.data),
);
const selfDetail = await passenger.supabase.from('sos_incident_details').select(DETAIL);
check(
  'nor does the passenger — it is the responders’ view',
  (selfDetail.data?.length ?? 0) === 0,
  JSON.stringify(selfDetail.data),
);
const anonDetail = await anon.from('sos_incident_details').select('id');
check('an anonymous caller is refused', (anonDetail.data?.length ?? 0) === 0);

// ---------------------------------------------------------------------------
console.log('\nDriving it forward');
// ---------------------------------------------------------------------------

const rivalAck = await roro.supabase.rpc('acknowledge_sos', { p_sos_id: incidentId });
check(
  'a rival operator cannot acknowledge it',
  rivalAck.error?.message === 'FORBIDDEN',
  rivalAck.error?.message,
);

const passengerAck = await passenger.supabase.rpc('acknowledge_sos', { p_sos_id: incidentId });
check(
  'the passenger cannot acknowledge their own alert',
  passengerAck.error?.message === 'FORBIDDEN',
  passengerAck.error?.message,
);

const ack = await cherry.supabase.rpc('acknowledge_sos', { p_sos_id: incidentId });
check('the owning operator can acknowledge it', !ack.error, ack.error?.message);
check('the status moved to ACKNOWLEDGED', ack.data?.status === 'ACKNOWLEDGED');
check('and it reports that something changed', ack.data?.changed === true);

const ackAgain = await cherry.supabase.rpc('acknowledge_sos', { p_sos_id: incidentId });
check('acknowledging twice is not an error', !ackAgain.error, ackAgain.error?.message);
check('and reports that nothing changed', ackAgain.data?.changed === false);

const { data: ackRow } = await cherry.supabase
  .from('sos_incidents')
  .select('acknowledged_at, acknowledged_by')
  .eq('id', incidentId)
  .single();
check('the acknowledgement is stamped', Boolean(ackRow?.acknowledged_at));
check('with who did it', ackRow?.acknowledged_by === cherry.userId);

const respond = await cherry.supabase.rpc('respond_sos', { p_sos_id: incidentId });
check('it can be marked as being responded to', respond.data?.status === 'RESPONDING');

const lateCancel = await passenger.supabase.rpc('cancel_sos', { p_sos_id: incidentId });
check(
  'the passenger can NOT cancel once a responder is moving',
  lateCancel.error?.message === 'INVALID_TRIP_STATUS',
  lateCancel.error?.message,
);

const resolve = await cherry.supabase.rpc('resolve_sos', {
  p_sos_id: incidentId,
  p_note: 'Attended at the terminal.',
});
check('it can be resolved', resolve.data?.status === 'RESOLVED', resolve.error?.message);

const { data: resolvedRow } = await cherry.supabase
  .from('sos_incidents')
  .select('resolved_at, resolved_by, note')
  .eq('id', incidentId)
  .single();
check('the resolution is stamped', Boolean(resolvedRow?.resolved_at));
check('with who resolved it', resolvedRow?.resolved_by === cherry.userId);
check('and the note is kept', resolvedRow?.note === 'Attended at the terminal.');

const reopen = await cherry.supabase.rpc('acknowledge_sos', { p_sos_id: incidentId });
check(
  'a resolved alert cannot be walked backwards',
  reopen.error?.message === 'INVALID_TRIP_STATUS',
  reopen.error?.message,
);

// ---------------------------------------------------------------------------
console.log('\nCancelling a false alarm');
// ---------------------------------------------------------------------------

// The previous one is RESOLVED, so the open-per-user index allows a new one.
const second = await passenger.supabase.rpc('trigger_sos', {
  p_latitude: HERE.latitude,
  p_longitude: HERE.longitude,
});
check('a new alert can be raised once the last is closed', !second.error, second.error?.message);

const otherCancel = await other.supabase.rpc('cancel_sos', { p_sos_id: second.data?.id });
check(
  'another passenger cannot cancel it',
  otherCancel.error?.message === 'FORBIDDEN',
  otherCancel.error?.message,
);

const cancel = await passenger.supabase.rpc('cancel_sos', { p_sos_id: second.data?.id });
check(
  'the passenger can cancel their own',
  cancel.data?.status === 'CANCELLED',
  cancel.error?.message,
);

// ---------------------------------------------------------------------------
console.log('\nThe trail it leaves');
// ---------------------------------------------------------------------------

const { data: audit } = await admin.supabase
  .from('audit_logs')
  .select('action')
  .eq('entity_id', incidentId)
  .order('created_at');
const actions = (audit ?? []).map((row) => row.action);
check(
  'every transition is audited',
  ['SOS_TRIGGERED', 'SOS_ACKNOWLEDGED', 'SOS_RESPONDING', 'SOS_RESOLVED'].every((a) =>
    actions.includes(a),
  ),
  actions.join(', '),
);

const { data: notes } = await passenger.supabase
  .from('notifications')
  .select('type')
  .eq('type', 'SOS');
check(
  'and the passenger is notified at each step',
  (notes?.length ?? 0) >= 4,
  String(notes?.length),
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
