/**
 * Bus and crew scheduling: what the database refuses.
 *
 *   pnpm db:verify:schedules
 *
 * The rule under test is that a coach cannot be in two places at once, and
 * neither can a driver. That is enforced by exclusion constraints rather than
 * by a check inside the insert, so the interesting cases are the ones a
 * check-then-write would get wrong:
 *
 *   - two trips whose windows merely touch across the turnaround buffer;
 *   - an overnight sailing whose arrival is the next morning, not fourteen
 *     hours before it left;
 *   - two operators pressing Save at the same instant.
 *
 * Plus everything around it: who may schedule, what an inactive bus or route
 * does to a sale, and that cancelling a trip releases its coach, cancels the
 * bookings, frees the seats and tells the passengers — without deleting a
 * thing.
 *
 * Re-runnable: every trip it creates is far enough in the future not to collide
 * with the seed, and is cancelled on the way out.
 *
 * Requires `supabase start`.
 */

import { createClient } from '@supabase/supabase-js';
import { loadVerifyEnv } from './_verify-env.mjs';

const { url: URL_, key: KEY } = loadVerifyEnv();
const PASSWORD = 'PalawanGo2026';
const RUN = Date.now().toString(36).slice(-5).toUpperCase();

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

/** Far enough out that nothing seeded, and no other suite, is near it. */
function dayAfter(offset) {
  const d = new Date();
  d.setDate(d.getDate() + 120 + offset);
  return d.toISOString().slice(0, 10);
}

const admin = await signIn('admin@palago.test');
const cherry = await signIn('operator@palago.test');
const roro = await signIn('roro@palago.test');
const driver = await signIn('driver@palago.test');
const passenger = await signIn('passenger@palago.test');

const { data: operators } = await admin.supabase.from('operators').select('id, code');
const cherryId = operators.find((o) => o.code === 'CHERRY').id;
const roroId = operators.find((o) => o.code === 'RORO').id;

const { data: cherryBuses } = await cherry.supabase
  .from('operator_fleet')
  .select('id, bus_number')
  .order('bus_number');
const { data: cherryRoutes } = await admin.supabase
  .from('routes')
  .select('id, duration_minutes')
  .eq('operator_id', cherryId)
  .order('created_at');
const { data: roroBuses } = await roro.supabase.from('operator_fleet').select('id').limit(1);
const { data: roroRoutes } = await admin.supabase
  .from('routes')
  .select('id')
  .eq('operator_id', roroId)
  .limit(1);

const busA = cherryBuses[0];
const busB = cherryBuses[1];
const route = cherryRoutes[0];

/** Trips this run created, cancelled on the way out. */
const created = [];

// A run that throws part-way through never reaches its own cleanup, and the
// trips it left behind still hold a coach and a driver — which makes the NEXT
// run fail on a conflict that has nothing to do with the code. Sweep first.
const { data: leftFromBefore } = await admin.supabase
  .from('trips')
  .select('id, trip_number')
  .like('trip_number', 'VS-%')
  .neq('status', 'CANCELLED');

for (const stale of leftFromBefore ?? []) {
  await admin.supabase.rpc('cancel_trip', {
    p_trip_id: stale.id,
    p_reason: 'Left over from an interrupted verify-schedules run',
  });
}
if ((leftFromBefore ?? []).length > 0) {
  console.log(`  (cleared ${leftFromBefore.length} trip(s) left by an earlier run)`);
}

async function createTrip(who, overrides = {}) {
  const body = {
    p_route_id: route.id,
    p_bus_id: busA.id,
    p_trip_number: `VS-${RUN}-${created.length + 1}`,
    p_departure_date: dayAfter(0),
    p_departure_time: '06:00:00',
    p_arrival_time: '12:00:00',
    p_fare: 50000,
    ...overrides,
  };
  const result = await who.supabase.rpc('create_trip', body);
  if (result.data?.id) created.push(result.data.id);
  return result;
}

// ---------------------------------------------------------------------------
console.log('\nScenario 1: who may put a bus on the road');
// ---------------------------------------------------------------------------

const first = await createTrip(cherry);
check('an operator can schedule their own trip', first.error === null, first.error?.message);

const byPassenger = await createTrip(passenger, { p_trip_number: `VS-${RUN}-PAX` });
check(
  'a passenger cannot',
  byPassenger.error?.message === 'VALIDATION_ERROR' || byPassenger.error?.message === 'FORBIDDEN',
  byPassenger.error?.message ?? 'it succeeded',
);

// A driver carries an operator id, which is exactly why this needs its own
// check rather than being assumed from the passenger case.
const byDriver = await createTrip(driver, {
  p_trip_number: `VS-${RUN}-DRV`,
  p_operator_id: cherryId,
});
check('nor a driver', byDriver.error?.message === 'FORBIDDEN', byDriver.error?.message ?? 'it succeeded');

const rivalBus = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-RB`,
  p_bus_id: roroBuses[0].id,
});
check(
  "an operator cannot schedule a rival's coach",
  rivalBus.error?.message === 'FORBIDDEN',
  rivalBus.error?.message ?? 'it succeeded',
);

const rivalRoute = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-RR`,
  p_route_id: roroRoutes[0].id,
});
check(
  "nor run it on a rival's route",
  rivalRoute.error?.message === 'FORBIDDEN',
  rivalRoute.error?.message ?? 'it succeeded',
);

const freeFare = await createTrip(cherry, { p_trip_number: `VS-${RUN}-F0`, p_fare: 0 });
check('a fare of zero is refused', freeFare.error?.message === 'VALIDATION_ERROR', freeFare.error?.message);

const duplicate = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-1`,
  p_departure_date: dayAfter(10),
});
check(
  'a trip number cannot be reused within an operator',
  duplicate.error?.message === 'VALIDATION_ERROR',
  duplicate.error?.message ?? 'it succeeded',
);

const directInsert = await cherry.supabase.from('trips').insert({
  operator_id: cherryId,
  route_id: route.id,
  bus_id: busA.id,
  trip_number: `VS-${RUN}-DIRECT`,
  departure_date: dayAfter(30),
  departure_time: '06:00:00',
  arrival_time: '12:00:00',
  fare: 50000,
});
check('and nobody schedules a trip by writing the table', directInsert.error !== null);

// ---------------------------------------------------------------------------
console.log('\nScenario 2: one coach, one place at a time');
// ---------------------------------------------------------------------------

const overlapping = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-OVL`,
  p_departure_time: '10:00:00',
  p_arrival_time: '16:00:00',
});
check(
  'the same bus cannot run two overlapping trips',
  overlapping.error?.message === 'SCHEDULE_CONFLICT',
  overlapping.error?.message ?? 'it succeeded',
);
check(
  'and the refusal names the trip it clashes with',
  overlapping.error?.details === `VS-${RUN}-1`,
  overlapping.error?.details ?? '(no detail)',
);

// The first arrives at 12:00. With a 30-minute turnaround it holds the coach
// until 12:30, so 12:15 is a clash and 12:30 is not.
const insideBuffer = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-BUF`,
  p_departure_time: '12:15:00',
  p_arrival_time: '18:00:00',
});
check(
  'nor depart again inside the turnaround buffer',
  insideBuffer.error?.message === 'SCHEDULE_CONFLICT',
  insideBuffer.error?.message ?? 'it succeeded',
);

const atBoundary = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-EDGE`,
  p_departure_time: '12:30:00',
  p_arrival_time: '18:00:00',
});
check(
  'but exactly at the end of the buffer is allowed',
  atBoundary.error === null,
  atBoundary.error?.message,
);

const otherBus = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-BUS2`,
  p_bus_id: busB.id,
  p_departure_time: '06:00:00',
  p_arrival_time: '12:00:00',
});
check('a different coach at the same hour is fine', otherBus.error === null, otherBus.error?.message);

// ---------------------------------------------------------------------------
console.log('\nScenario 3: an arrival before the departure means tomorrow');
// ---------------------------------------------------------------------------

const overnight = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-NIGHT`,
  p_departure_date: dayAfter(2),
  p_departure_time: '20:00:00',
  p_arrival_time: '06:00:00',
});
check('an overnight departure can be scheduled', overnight.error === null, overnight.error?.message);

const { data: overnightRow } = await admin.supabase
  .from('trips')
  .select('departure_at, arrival_at')
  .eq('id', overnight.data.id)
  .single();
check(
  'and it is ten hours long, not minus fourteen',
  new Date(overnightRow.arrival_at) - new Date(overnightRow.departure_at) === 10 * 3600 * 1000,
  `${overnightRow.departure_at} → ${overnightRow.arrival_at}`,
);

// The morning after: the coach is still at sea until 06:00, plus turnaround.
const morningAfter = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-MORN`,
  p_departure_date: dayAfter(3),
  p_departure_time: '04:00:00',
  p_arrival_time: '09:00:00',
});
check(
  'so the next morning is still occupied by it',
  morningAfter.error?.message === 'SCHEDULE_CONFLICT',
  morningAfter.error?.message ?? 'it succeeded',
);

const afterTurnaround = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-LATER`,
  p_departure_date: dayAfter(3),
  p_departure_time: '07:00:00',
  p_arrival_time: '12:00:00',
});
check('and free once it has docked and turned around', afterTurnaround.error === null, afterTurnaround.error?.message);

// ---------------------------------------------------------------------------
console.log('\nScenario 4: the turnaround buffer is configuration');
// ---------------------------------------------------------------------------

const readable = await cherry.supabase.rpc('public_setting', { p_key: 'trip_turnaround_minutes' });
check('an operator can read the buffer', readable.data === '30', readable.data ?? readable.error?.message);

const secretPeek = await cherry.supabase.rpc('public_setting', { p_key: 'push_webhook_secret' });
check(
  'but not anything else in app_settings',
  secretPeek.error?.message === 'FORBIDDEN',
  secretPeek.data ?? secretPeek.error?.message,
);

const { data: settingsTable } = await admin.supabase.from('app_settings').select('key');
check('and the table itself stays closed to everyone', (settingsTable ?? []).length === 0);

const operatorTunes = await cherry.supabase.rpc('set_turnaround_minutes', { p_minutes: 90 });
check(
  'an operator cannot change it',
  operatorTunes.error?.message === 'FORBIDDEN',
  operatorTunes.error?.message ?? 'it succeeded',
);

// `V-1` arrives 12:00 and `V-EDGE` leaves 12:30: legal at a 30-minute buffer,
// impossible at 90. Widening is therefore refused outright rather than applied
// to some trips and not others — and it says which pair is in the way.
const refusedWiden = await admin.supabase.rpc('set_turnaround_minutes', { p_minutes: 90 });
check(
  'widening is refused when it would put two coaches on top of each other',
  refusedWiden.error?.message === 'SCHEDULE_CONFLICT',
  refusedWiden.error?.message ?? 'it succeeded',
);
// Which pair, not just "there is one". More than one of this run's trips can
// be tight at 90 minutes, so the assertion is the shape — two named trips from
// this run — rather than one particular pair.
check(
  'and it names the pair rather than leaving an admin hunting',
  (refusedWiden.error?.details ?? '').split(' and ').length === 2 &&
    (refusedWiden.error?.details ?? '')
      .split(' and ')
      .every((name) => name.startsWith(`VS-${RUN}-`)),
  refusedWiden.error?.details ?? '(no detail)',
);

const { data: unchangedBuffer } = await cherry.supabase.rpc('public_setting', {
  p_key: 'trip_turnaround_minutes',
});
check('the buffer is left where it was', unchangedBuffer === '30', unchangedBuffer);

// Both of the deliberately-tight pairs this run has built so far: the 12:30
// departure after a 12:00 arrival, and the 07:00 one after the overnight
// sailing docks at 06:00. Each is legal at 30 minutes and impossible at 90.
for (const tight of [atBoundary, afterTurnaround]) {
  await cherry.supabase.rpc('cancel_trip', {
    p_trip_id: tight.data.id,
    p_reason: 'Making room to widen the buffer',
  });
}

const widened = await admin.supabase.rpc('set_turnaround_minutes', { p_minutes: 90 });
check('with the tight pair gone, an admin can widen it', widened.error === null, widened.error?.message);
check('and future trips are re-stamped', (widened.data?.tripsRestamped ?? 0) > 0, JSON.stringify(widened.data));

const baseline = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-BASE`,
  p_departure_date: dayAfter(5),
  p_departure_time: '06:00:00',
  p_arrival_time: '12:00:00',
  p_bus_id: busB.id,
});
check('a baseline trip on the widened buffer', baseline.error === null, baseline.error?.message);

const insideWiderBuffer = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-WIDE2`,
  p_departure_date: dayAfter(5),
  p_departure_time: '13:00:00',
  p_arrival_time: '18:00:00',
  p_bus_id: busB.id,
});
check(
  'and 13:00 — legal at 30 minutes — is now a clash at 90',
  insideWiderBuffer.error?.message === 'SCHEDULE_CONFLICT',
  insideWiderBuffer.error?.message ?? 'it succeeded',
);

const restored = await admin.supabase.rpc('set_turnaround_minutes', { p_minutes: 30 });
check('the buffer can be set back', restored.error === null, restored.error?.message);

const silly = await admin.supabase.rpc('set_turnaround_minutes', { p_minutes: -5 });
check('a negative buffer is refused', silly.error?.message === 'VALIDATION_ERROR', silly.error?.message);

// ---------------------------------------------------------------------------
console.log('\nScenario 5: one driver, one bus');
// ---------------------------------------------------------------------------

const { data: crew } = await cherry.supabase
  .from('operator_crew')
  .select('id, crew_kind, name, availability_status')
  .eq('availability_status', 'AVAILABLE')
  .order('name');

const aDriver = crew.find((c) => c.crew_kind === 'DRIVER');
const anAssistant = crew.find((c) => c.crew_kind === 'CREW');

const tripOne = first.data.id;
const tripTwo = otherBus.data.id;

const crewed = await cherry.supabase.rpc('assign_trip_crew', {
  p_trip_id: tripOne,
  p_driver_id: aDriver.id,
  p_assistant_id: anAssistant.id,
});
check('a trip can be crewed', crewed.error === null, crewed.error?.message);

// Different coach, same hour — fine for the bus, impossible for the person.
const doubleBookedDriver = await cherry.supabase.rpc('assign_trip_crew', {
  p_trip_id: tripTwo,
  p_driver_id: aDriver.id,
});
check(
  'the same driver cannot crew an overlapping trip on another coach',
  doubleBookedDriver.error?.message === 'SCHEDULE_CONFLICT',
  doubleBookedDriver.error?.message ?? 'it succeeded',
);
check(
  'and that refusal names the clash too',
  doubleBookedDriver.error?.details === `VS-${RUN}-1`,
  doubleBookedDriver.error?.details ?? '(no detail)',
);

const doubleBookedAssistant = await cherry.supabase.rpc('assign_trip_crew', {
  p_trip_id: tripTwo,
  p_assistant_id: anAssistant.id,
});
check(
  'nor the same conductor',
  doubleBookedAssistant.error?.message === 'SCHEDULE_CONFLICT',
  doubleBookedAssistant.error?.message ?? 'it succeeded',
);

const rivalCrew = await roro.supabase.rpc('assign_trip_crew', {
  p_trip_id: tripTwo,
  p_driver_id: aDriver.id,
});
check(
  "a rival operator cannot crew somebody else's trip",
  rivalCrew.error?.message === 'FORBIDDEN',
  rivalCrew.error?.message ?? 'it succeeded',
);

// An expired licence is the concrete reading of "qualified for the trip".
const expired = await cherry.supabase.rpc('create_crew_member', {
  p_kind: 'DRIVER',
  p_name: `Lapsed Licence ${RUN}`,
  p_license_number: `EXP-${RUN}`,
  p_license_expiration_date: new Date(Date.now() - 86400_000).toISOString().slice(0, 10),
});
const lapsed = await cherry.supabase.rpc('assign_trip_crew', {
  p_trip_id: tripTwo,
  p_driver_id: expired.data.id,
});
check(
  'a driver whose licence expires before departure is refused',
  lapsed.error?.message === 'LICENSE_EXPIRED',
  lapsed.error?.message ?? 'it succeeded',
);

const freed = await cherry.supabase.rpc('unassign_trip_crew', { p_trip_id: tripOne });
check('crew can be taken off a trip', freed.error === null, freed.error?.message);

const reassigned = await cherry.supabase.rpc('assign_trip_crew', {
  p_trip_id: tripTwo,
  p_driver_id: aDriver.id,
});
check('which frees them for the overlapping one', reassigned.error === null, reassigned.error?.message);

// The window an assignment holds is copied from its trip. Moving the trip has
// to move the copy, or the two disagree about what "overlapping" means.
const { data: tripTwoRow } = await admin.supabase
  .from('trips')
  .select('route_id, bus_id, trip_number, departure_date, departure_time, arrival_time, fare')
  .eq('id', tripTwo)
  .single();

const moved = await cherry.supabase.rpc('update_trip', {
  p_trip_id: tripTwo,
  p_route_id: tripTwoRow.route_id,
  p_bus_id: tripTwoRow.bus_id,
  p_trip_number: tripTwoRow.trip_number,
  p_departure_date: dayAfter(40),
  p_departure_time: tripTwoRow.departure_time,
  p_arrival_time: tripTwoRow.arrival_time,
  p_fare: tripTwoRow.fare,
});
check('a scheduled trip can be moved', moved.error === null, moved.error?.message);

const { data: movedAssignment } = await admin.supabase
  .from('trip_assignments')
  .select('blocked_range')
  .eq('trip_id', tripTwo)
  .eq('status', 'ASSIGNED')
  .single();
check(
  "and its crew's window moves with it",
  movedAssignment.blocked_range.includes(dayAfter(40)),
  movedAssignment.blocked_range,
);

const nowFree = await cherry.supabase.rpc('assign_trip_crew', {
  p_trip_id: tripOne,
  p_driver_id: aDriver.id,
});
check(
  'so the driver is free for the slot it left',
  nowFree.error === null,
  nowFree.error?.message,
);

// ---------------------------------------------------------------------------
console.log('\nScenario 6: two operators pressing Save at the same instant');
// ---------------------------------------------------------------------------

const raceDate = dayAfter(60);
const race = await Promise.all([
  cherry.supabase.rpc('create_trip', {
    p_route_id: route.id,
    p_bus_id: busA.id,
    p_trip_number: `VS-${RUN}-RACE-A`,
    p_departure_date: raceDate,
    p_departure_time: '08:00:00',
    p_arrival_time: '14:00:00',
    p_fare: 50000,
  }),
  cherry.supabase.rpc('create_trip', {
    p_route_id: route.id,
    p_bus_id: busA.id,
    p_trip_number: `VS-${RUN}-RACE-B`,
    p_departure_date: raceDate,
    p_departure_time: '09:00:00',
    p_arrival_time: '15:00:00',
    p_fare: 50000,
  }),
]);

for (const r of race) if (r.data?.id) created.push(r.data.id);

const won = race.filter((r) => r.error === null).length;
check(
  'exactly one of two simultaneous conflicting trips is created',
  won === 1,
  `${won} succeeded: ${race.map((r) => r.error?.message ?? 'ok').join(', ')}`,
);

const { data: raceRows } = await admin.supabase
  .from('trips')
  .select('trip_number')
  .like('trip_number', `VS-${RUN}-RACE-%`);
check('and only one row exists', (raceRows ?? []).length === 1, `${raceRows?.length} rows`);

// ---------------------------------------------------------------------------
console.log('\nScenario 7: an inactive coach stops selling seats');
// ---------------------------------------------------------------------------

const sellable = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-SELL`,
  p_departure_date: dayAfter(70),
  p_departure_time: '06:00:00',
  p_arrival_time: '12:00:00',
  p_bus_id: busB.id,
});
check('a trip to sell seats on', sellable.error === null, sellable.error?.message);

const beforeBooking = await passenger.supabase.rpc('create_booking', {
  p_trip_id: sellable.data.id,
  p_passengers: [{ name: 'Before Withdrawal', phone: '09171234567', email: null, type: 'ADULT' }],
});
check('a passenger can book it', beforeBooking.error === null, beforeBooking.error?.message);

const withdrawn = await admin.supabase.rpc('set_bus_status', {
  p_bus_id: busB.id,
  p_status: 'INACTIVE',
  p_reason: 'Off the road (verify-schedules)',
});
check('the admin can take the coach off the road', withdrawn.error === null, withdrawn.error?.message);
check(
  'and is told how many departures it still has',
  (withdrawn.data?.upcomingTrips ?? 0) > 0,
  JSON.stringify(withdrawn.data),
);

const afterBooking = await passenger.supabase.rpc('create_booking', {
  p_trip_id: sellable.data.id,
  p_passengers: [{ name: 'After Withdrawal', phone: '09171234567', email: null, type: 'ADULT' }],
});
check(
  'no new seat can be sold on it',
  afterBooking.error?.message === 'INACTIVE_RESOURCE',
  afterBooking.error?.message ?? 'the booking succeeded',
);

const { data: searchRow } = await passenger.supabase
  .from('trip_search')
  .select('bus_status, operator_status, route_status')
  .eq('id', sellable.data.id)
  .single();
check('search can see that it is inactive', searchRow.bus_status === 'INACTIVE', searchRow.bus_status);

// The ticket somebody already holds must still resolve. Filtering the view
// outright would 404 it.
const { data: existing, error: existingError } = await passenger.supabase
  .from('trip_search')
  .select('id')
  .eq('id', sellable.data.id)
  .single();
check(
  'but a ticket already sold on it still opens',
  !existingError && existing.id === sellable.data.id,
  existingError?.message,
);

const scheduleOnWithdrawn = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-DEAD`,
  p_departure_date: dayAfter(80),
  p_bus_id: busB.id,
});
check(
  'and it cannot be scheduled again',
  scheduleOnWithdrawn.error?.message === 'INACTIVE_RESOURCE',
  scheduleOnWithdrawn.error?.message ?? 'it succeeded',
);

await admin.supabase.rpc('set_bus_status', { p_bus_id: busB.id, p_status: 'ACTIVE' });

// ---------------------------------------------------------------------------
console.log('\nScenario 8: cancelling releases everything and deletes nothing');
// ---------------------------------------------------------------------------

const cancelled = await cherry.supabase.rpc('cancel_trip', {
  p_trip_id: sellable.data.id,
  p_reason: 'Engine trouble',
});
check('the operator can cancel a trip', cancelled.error === null, cancelled.error?.message);
check(
  'and the live booking on it is cancelled with it',
  (cancelled.data?.bookingsCancelled ?? 0) >= 1,
  JSON.stringify(cancelled.data),
);

const { data: cancelledBooking } = await passenger.supabase
  .from('bookings')
  .select('status')
  .eq('id', beforeBooking.data.bookingId)
  .single();
check('the passenger sees it as CANCELLED', cancelledBooking.status === 'CANCELLED', cancelledBooking.status);

const { data: seats } = await admin.supabase
  .from('trip_seats')
  .select('status')
  .eq('trip_id', sellable.data.id)
  .neq('status', 'AVAILABLE');
check('its seats are released', (seats ?? []).length === 0, `${seats?.length} still held`);

const { data: told } = await passenger.supabase
  .from('notifications')
  .select('type, data')
  .eq('type', 'TRIP_CANCELLED')
  .order('created_at', { ascending: false })
  .limit(1);
check(
  'and the passenger is told',
  told?.[0]?.data?.tripId === sellable.data.id,
  JSON.stringify(told?.[0]?.data),
);

const { data: stillThere } = await admin.supabase
  .from('trips')
  .select('status, cancelled_reason, cancelled_by')
  .eq('id', sellable.data.id)
  .single();
check('the trip itself is not deleted', stillThere.status === 'CANCELLED');
check('the reason is kept', stillThere.cancelled_reason === 'Engine trouble', stillThere.cancelled_reason);
check('and so is who cancelled it', stillThere.cancelled_by === cherry.userId);

const again = await cherry.supabase.rpc('cancel_trip', { p_trip_id: sellable.data.id });
check('cancelling twice changes nothing', again.data?.changed === false, JSON.stringify(again.data));

// A cancelled trip no longer holds its coach.
const reclaimed = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-RECLAIM`,
  p_departure_date: dayAfter(70),
  p_departure_time: '06:00:00',
  p_arrival_time: '12:00:00',
  p_bus_id: busB.id,
});
check('and its slot is free again', reclaimed.error === null, reclaimed.error?.message);

// ---------------------------------------------------------------------------
console.log('\nScenario 9: withdrawing a schedule is not cancelling it');
// ---------------------------------------------------------------------------

const withdrawTarget = await createTrip(cherry, {
  p_trip_number: `VS-${RUN}-WDR`,
  p_departure_date: dayAfter(90),
  p_departure_time: '06:00:00',
  p_arrival_time: '12:00:00',
});
const booked = await passenger.supabase.rpc('create_booking', {
  p_trip_id: withdrawTarget.data.id,
  p_passengers: [{ name: 'Holds A Seat', phone: '09171234567', email: null, type: 'ADULT' }],
});
check('a trip with a seat sold on it', booked.error === null, booked.error?.message);

const refusedWithdraw = await cherry.supabase.rpc('set_trip_active', {
  p_trip_id: withdrawTarget.data.id,
  p_active: false,
});
check(
  'cannot simply be withdrawn — the honest word for that is cancelled',
  refusedWithdraw.error?.message === 'VALIDATION_ERROR',
  refusedWithdraw.error?.message ?? 'it succeeded',
);

await admin.supabase.rpc('cancel_booking', { p_booking_id: booked.data.bookingId });

const nowWithdraw = await cherry.supabase.rpc('set_trip_active', {
  p_trip_id: withdrawTarget.data.id,
  p_active: false,
});
check('with nobody aboard it can be', nowWithdraw.error === null, nowWithdraw.error?.message);

const bookWithdrawn = await passenger.supabase.rpc('create_booking', {
  p_trip_id: withdrawTarget.data.id,
  p_passengers: [{ name: 'Too Late', phone: '09171234567', email: null, type: 'ADULT' }],
});
check(
  'and it stops selling',
  bookWithdrawn.error?.message === 'INACTIVE_RESOURCE',
  bookWithdrawn.error?.message ?? 'the booking succeeded',
);

// ---------------------------------------------------------------------------
console.log('\nCleaning up');
// ---------------------------------------------------------------------------

let cleaned = 0;
for (const id of created) {
  const { error } = await admin.supabase.rpc('cancel_trip', {
    p_trip_id: id,
    p_reason: 'verify-schedules cleanup',
  });
  if (!error) cleaned += 1;
}
check(
  'every trip this run created is cancelled again',
  cleaned === created.length,
  `${cleaned}/${created.length}`,
);

const { data: leftovers } = await admin.supabase
  .from('trips')
  .select('trip_number')
  .like('trip_number', `VS-${RUN}-%`)
  .neq('status', 'CANCELLED');
check('and none is left occupying a coach', (leftovers ?? []).length === 0, JSON.stringify(leftovers));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
