/**
 * Live trip tracking — verified against the local stack with real signed-in
 * roles.
 *
 *   pnpm db:verify:tracking
 *
 * What this exists to prove, none of which a unit test can show:
 *
 *   - a driver can publish a position ONLY for their own live trip
 *   - a passenger, a rival operator and an anonymous caller cannot publish at all
 *   - a passenger sees the bus only while holding a live booking; cancelling
 *     the booking takes the tracking away again
 *   - nobody can rewrite or delete the GPS trail, including the driver who
 *     wrote it — a trail that can be edited is not evidence of anything
 *   - the trip lifecycle is idempotent: two `start_trip` calls do not move the
 *     recorded departure time
 *   - the on-time rate is computed from real timestamps and moves correctly
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
  return { supabase, accessToken: data.session.access_token, userId: data.user.id };
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

async function invoke(fn, body, accessToken) {
  const res = await fetch(`${URL_}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: KEY,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Somewhere on the Puerto Princesa–El Nido road, roughly.
const PPS = { latitude: 9.7392, longitude: 118.7353 };

const driver = await signIn('driver@palago.test');
const assistant = await signIn('assistant@palago.test');
const cherry = await signIn('operator@palago.test');
const roro = await signIn('roro@palago.test');
const passenger = await signIn('passenger@palago.test');
const other = await signIn('passenger2@palago.test');

// ---------------------------------------------------------------------------
console.log('\nThe driver sees their own board');
// ---------------------------------------------------------------------------

const myTrips = (await driver.supabase.from('driver_assignments').select('trip_id, trip_number'))
  .data ?? [];
check('a driver sees their assignments', myTrips.length > 0, `${myTrips.length}`);
check(
  'and only Cherry trips',
  myTrips.every((t) => t.trip_number.startsWith('CHERRY')),
  [...new Set(myTrips.map((t) => t.trip_number.split('-')[0]))].join(', '),
);

const roroBoard = (await roro.supabase.from('driver_assignments').select('trip_id')).data ?? [];
check(
  'an operator is not crew and sees no assignments of their own',
  roroBoard.length === 0,
  `saw ${roroBoard.length}`,
);
const paxBoard = (await passenger.supabase.from('driver_assignments').select('trip_id')).data ?? [];
check('a passenger sees no crew board', paxBoard.length === 0, `saw ${paxBoard.length}`);

// A trip that has not run yet, so the lifecycle checks start from scratch — and
// one this passenger has no live booking on, because the first thing the suite
// asserts is that they *cannot* track it. Earlier suites pay for seats on the
// seeded trips, and a paid booking is exactly what buys tracking.
const candidates =
  (
    await driver.supabase
      .from('driver_assignments')
      .select('trip_id, trip_number, trip_status')
      .eq('trip_status', 'SCHEDULED')
  ).data ?? [];

// Neither passenger, not just the one doing the booking: the suite also asserts
// that the *other* passenger stays a stranger to this trip throughout, and the
// seed gives passenger2 an upcoming booking of their own.
const liveTripsOf = async (session) =>
  ((await session.supabase.from('bookings').select('trip_id, status')).data ?? [])
    .filter((b) => !['CANCELLED', 'REFUNDED'].includes(b.status))
    .map((b) => b.trip_id);

const spokenFor = new Set([...(await liveTripsOf(passenger)), ...(await liveTripsOf(other))]);

const trip = candidates.find((c) => !spokenFor.has(c.trip_id));

if (!trip) {
  check(
    'a SCHEDULED Cherry trip neither test passenger has booked exists (seed data)',
    false,
    `${candidates.length} scheduled, all already booked by one of them`,
  );
} else {
  const tripId = trip.trip_id;

  // -------------------------------------------------------------------------
  console.log('\nA booking is what buys tracking');
  //
  // Booked here, while the trip is still SCHEDULED: `create_booking` refuses a
  // trip that has already departed, which is correct -- you cannot buy a seat
  // on a bus that has left. The first version of this suite booked after
  // starting the trip and was wrong about the product, not about the code.
  // -------------------------------------------------------------------------

  const beforeBooking =
    (await passenger.supabase.from('trip_live_position').select('trip_id').eq('trip_id', tripId))
      .data ?? [];
  check(
    'before booking, the passenger cannot track this trip',
    beforeBooking.length === 0,
    `saw ${beforeBooking.length}`,
  );

  const booking = await passenger.supabase.rpc('create_booking', {
    p_trip_id: tripId,
    p_passengers: [
      { name: 'Tracking Test', phone: '09171234567', email: null, type: 'ADULT' },
    ],
  });
  check('the passenger can book a seat on it', !booking.error, booking.error?.message);

  // An unpaid booking is not a ticket. Tracking must not come with a hold.
  const whileUnpaid =
    (await passenger.supabase.from('trip_live_position').select('trip_id').eq('trip_id', tripId))
      .data ?? [];
  check(
    'an UNPAID booking does not grant tracking',
    whileUnpaid.length === 0,
    `saw ${whileUnpaid.length}`,
  );

  const created = await invoke(
    'create-test-payment',
    { bookingId: booking.data.bookingId },
    passenger.accessToken,
  );
  const payToken = new URL(created.body.data.paymentUrl).searchParams.get('t');
  await invoke('confirm-test-payment', { reference: created.body.data.reference, token: payToken });

  // -------------------------------------------------------------------------
  console.log('\nNobody publishes before the trip starts');
  // -------------------------------------------------------------------------

  const earlyPing = await driver.supabase.from('bus_locations').insert({
    trip_id: tripId,
    ...PPS,
  });
  check(
    'the assigned driver cannot publish while the trip is only SCHEDULED',
    Boolean(earlyPing.error),
    'the insert succeeded',
  );

  // -------------------------------------------------------------------------
  console.log('\nTrip lifecycle');
  // -------------------------------------------------------------------------

  const paxStart = await passenger.supabase.rpc('start_trip', { p_trip_id: tripId });
  check('a passenger cannot start a trip', Boolean(paxStart.error), 'the call succeeded');

  const roroStart = await roro.supabase.rpc('start_trip', { p_trip_id: tripId });
  check("a rival operator cannot start Cherry's trip", Boolean(roroStart.error), 'it succeeded');

  const boarding = await driver.supabase.rpc('set_trip_boarding', { p_trip_id: tripId });
  check(
    'the driver can open boarding',
    !boarding.error && boarding.data?.status === 'BOARDING',
    boarding.error?.message ?? JSON.stringify(boarding.data),
  );

  const started = await driver.supabase.rpc('start_trip', { p_trip_id: tripId });
  check(
    'the driver can start the trip',
    !started.error && started.data?.status === 'DEPARTED',
    started.error?.message ?? JSON.stringify(started.data),
  );
  check(
    'and an actual departure time is recorded',
    Boolean(started.data?.actualDepartureAt),
    JSON.stringify(started.data),
  );

  // The idempotency that matters: a retry after a dropped response must not
  // move the time the driver will later be judged against.
  const restarted = await driver.supabase.rpc('start_trip', { p_trip_id: tripId });
  check(
    'starting it twice is idempotent',
    !restarted.error && restarted.data?.alreadyStarted === true,
    JSON.stringify(restarted.data),
  );
  check(
    'and does NOT move the recorded departure time',
    restarted.data?.actualDepartureAt === started.data?.actualDepartureAt,
    `${started.data?.actualDepartureAt} -> ${restarted.data?.actualDepartureAt}`,
  );

  // -------------------------------------------------------------------------
  console.log('\nPublishing a position');
  // -------------------------------------------------------------------------

  const ping = await driver.supabase.from('bus_locations').insert({ trip_id: tripId, ...PPS });
  check('the assigned driver can publish once the trip is live', !ping.error, ping.error?.message);

  const stamped = (
    await driver.supabase
      .from('bus_locations')
      .select('driver_id, latitude, longitude')
      .eq('trip_id', tripId)
      .limit(1)
  ).data?.[0];
  check(
    'the row is stamped with the driver by default, not by the client',
    Boolean(stamped?.driver_id),
    JSON.stringify(stamped),
  );

  // Everyone who must NOT be able to publish.
  const assistantPing = await assistant.supabase
    .from('bus_locations')
    .insert({ trip_id: tripId, ...PPS });
  check(
    'an assistant on the same trip cannot publish',
    Boolean(assistantPing.error),
    'the insert succeeded',
  );

  const operatorPing = await cherry.supabase
    .from('bus_locations')
    .insert({ trip_id: tripId, ...PPS });
  check(
    'the operator cannot publish a position for their own bus',
    Boolean(operatorPing.error),
    'the insert succeeded',
  );

  const paxPing = await passenger.supabase
    .from('bus_locations')
    .insert({ trip_id: tripId, ...PPS });
  check('a passenger cannot publish', Boolean(paxPing.error), 'the insert succeeded');

  const anonPing = await client().from('bus_locations').insert({ trip_id: tripId, ...PPS });
  check('an anonymous caller cannot publish', Boolean(anonPing.error), 'the insert succeeded');

  // Impersonation: naming someone else's driver record explicitly.
  const roroDriverId = (
    await roro.supabase.from('drivers').select('id').limit(1)
  ).data?.[0]?.id;
  if (roroDriverId) {
    const spoof = await driver.supabase
      .from('bus_locations')
      .insert({ trip_id: tripId, driver_id: roroDriverId, ...PPS });
    check(
      "a driver cannot post under another operator's driver id",
      Boolean(spoof.error),
      'the insert succeeded',
    );
  }

  // A driver posting to a trip they are not assigned to.
  const foreignTrip = (
    await roro.supabase.from('operator_trip_overview').select('id').limit(1)
  ).data?.[0];
  if (foreignTrip) {
    const crossPing = await driver.supabase
      .from('bus_locations')
      .insert({ trip_id: foreignTrip.id, ...PPS });
    check(
      'a driver cannot publish for a trip they are not assigned to',
      Boolean(crossPing.error),
      'the insert succeeded',
    );
  }

  // -------------------------------------------------------------------------
  console.log('\nThe trail cannot be rewritten');
  // -------------------------------------------------------------------------

  const mine = (
    await driver.supabase.from('bus_locations').select('id').eq('trip_id', tripId).limit(1)
  ).data?.[0];

  const edit = await driver.supabase
    .from('bus_locations')
    .update({ latitude: 0, longitude: 0 })
    .eq('id', mine.id)
    .select();
  check(
    'the driver cannot edit a position they published',
    Boolean(edit.error) || edit.data?.length === 0,
    'the update applied',
  );

  const wipe = await driver.supabase.from('bus_locations').delete().eq('id', mine.id).select();
  check(
    'and cannot delete it either',
    Boolean(wipe.error) || wipe.data?.length === 0,
    'the delete applied',
  );

  const operatorEdit = await cherry.supabase
    .from('bus_locations')
    .update({ latitude: 0 })
    .eq('id', mine.id)
    .select();
  check(
    'nor can the operator who owns the bus',
    Boolean(operatorEdit.error) || operatorEdit.data?.length === 0,
    'the update applied',
  );

  // -------------------------------------------------------------------------
  console.log('\nWho may watch');
  // -------------------------------------------------------------------------

  const anonWatch = (await client().from('bus_locations').select('id').eq('trip_id', tripId))
    .data ?? [];
  check('an anonymous caller sees no positions', anonWatch.length === 0, `saw ${anonWatch.length}`);

  const strangerWatch =
    (await other.supabase.from('bus_locations').select('id').eq('trip_id', tripId)).data ?? [];
  check(
    'a passenger with no booking on the trip sees nothing',
    strangerWatch.length === 0,
    `saw ${strangerWatch.length}`,
  );

  const roroWatch =
    (await roro.supabase.from('bus_locations').select('id').eq('trip_id', tripId)).data ?? [];
  check("a rival operator cannot watch Cherry's bus", roroWatch.length === 0, `saw ${roroWatch.length}`);

  const operatorWatch =
    (await cherry.supabase.from('trip_live_position').select('latitude').eq('trip_id', tripId))
      .data ?? [];
  check(
    'the owning operator can watch it',
    operatorWatch.length === 1 && operatorWatch[0].latitude !== null,
    JSON.stringify(operatorWatch),
  );

  const crewWatch =
    (await assistant.supabase.from('trip_live_position').select('latitude').eq('trip_id', tripId))
      .data ?? [];
  check('so can the assistant on board', crewWatch.length === 1, `saw ${crewWatch.length}`);

  // -------------------------------------------------------------------------
  console.log('\nThe position reaches the ticket holder, and cancelling takes it away');
  // -------------------------------------------------------------------------

  const afterPaying =
    (await passenger.supabase
      .from('trip_live_position')
      .select('trip_id, latitude, longitude')
      .eq('trip_id', tripId)).data ?? [];
  check(
    'a CONFIRMED booking does grant tracking',
    afterPaying.length === 1,
    `saw ${afterPaying.length}`,
  );
  check(
    'and the position is the one the driver published',
    Number(afterPaying[0]?.latitude) === PPS.latitude,
    JSON.stringify(afterPaying[0]),
  );

  const trail =
    (await passenger.supabase.from('bus_locations').select('id').eq('trip_id', tripId)).data ?? [];
  check('the passenger can read the trail too', trail.length > 0, `saw ${trail.length}`);

  // The other passenger still must not, even now that positions exist.
  const stillStranger =
    (await other.supabase.from('trip_live_position').select('trip_id').eq('trip_id', tripId))
      .data ?? [];
  check(
    'another passenger still sees nothing',
    stillStranger.length === 0,
    `saw ${stillStranger.length}`,
  );

  // A *paid* booking cannot be cancelled — `cancel_booking` raises
  // BOOKING_ALREADY_CONFIRMED, which is right: money changed hands, so it is a
  // refund, not a cancellation. (That mistake is what the first run of this
  // suite made.) Refunding is the real way to lose the entitlement.
  const badCancel = await passenger.supabase.rpc('cancel_booking', {
    p_booking_id: booking.data.bookingId,
  });
  check(
    'a paid booking cannot simply be cancelled',
    Boolean(badCancel.error),
    'the call succeeded',
  );

  const refunded = await passenger.supabase.rpc('refund_test_payment', {
    p_booking_id: booking.data.bookingId,
  });
  check('the passenger can refund their test payment', !refunded.error, refunded.error?.message);

  const afterRefund =
    (await passenger.supabase.from('trip_live_position').select('trip_id').eq('trip_id', tripId))
      .data ?? [];
  check(
    'refunding the booking takes tracking away again',
    afterRefund.length === 0,
    `saw ${afterRefund.length}`,
  );

  const afterRefundTrail =
    (await passenger.supabase.from('bus_locations').select('id').eq('trip_id', tripId)).data ?? [];
  check(
    'and the trail with it',
    afterRefundTrail.length === 0,
    `saw ${afterRefundTrail.length}`,
  );

  // -------------------------------------------------------------------------
  console.log('\nEnding the trip closes the write path');
  // -------------------------------------------------------------------------

  const paxEnd = await passenger.supabase.rpc('end_trip', { p_trip_id: tripId });
  check('a passenger cannot end a trip', Boolean(paxEnd.error), 'the call succeeded');

  const ended = await driver.supabase.rpc('end_trip', { p_trip_id: tripId });
  check(
    'the driver can end the trip',
    !ended.error && ended.data?.status === 'ARRIVED',
    ended.error?.message ?? JSON.stringify(ended.data),
  );
  check('and an arrival time is recorded', Boolean(ended.data?.actualArrivalAt), JSON.stringify(ended.data));

  const endedTwice = await driver.supabase.rpc('end_trip', { p_trip_id: tripId });
  check(
    'ending it twice is idempotent',
    !endedTwice.error && endedTwice.data?.alreadyEnded === true,
    JSON.stringify(endedTwice.data),
  );
  check(
    'and does NOT move the recorded arrival time',
    endedTwice.data?.actualArrivalAt === ended.data?.actualArrivalAt,
    `${ended.data?.actualArrivalAt} -> ${endedTwice.data?.actualArrivalAt}`,
  );

  const pingAfterEnd = await driver.supabase
    .from('bus_locations')
    .insert({ trip_id: tripId, ...PPS });
  check(
    'the driver cannot publish once the trip has ended',
    Boolean(pingAfterEnd.error),
    'the insert succeeded',
  );

  const restartAfterEnd = await driver.supabase.rpc('start_trip', { p_trip_id: tripId });
  check(
    'and cannot restart an arrived trip',
    Boolean(restartAfterEnd.error),
    'the call succeeded',
  );

  // -------------------------------------------------------------------------
  console.log('\nOn-time performance is computed, not invented');
  // -------------------------------------------------------------------------

  // Ask about the day this trip actually departs, not "today" — the seed puts
  // trips across three dates and the run may pick any of them.
  const tripDate = (
    await cherry.supabase
      .from('operator_trip_overview')
      .select('departure_date')
      .eq('id', tripId)
      .single()
  ).data?.departure_date;

  const dash = (await cherry.supabase.rpc('operator_dashboard', { p_date: tripDate })).data;
  const today = dash?.today;

  check('the dashboard reports a departed count', typeof today?.departed === 'number', JSON.stringify(today?.departed));
  check(
    'and an on-time percentage once something has departed',
    today?.departed === 0 ? today?.onTime === null : typeof today?.onTime === 'number',
    `departed ${today?.departed}, onTime ${today?.onTime}`,
  );
  check(
    'the grace window is reported so the number can be read correctly',
    today?.onTimeGraceMinutes === 15,
    String(today?.onTimeGraceMinutes),
  );

  // The trip we just ran departed today but was scheduled for its own date, so
  // check the delay is a real number derived from the two timestamps.
  const overview = (
    await cherry.supabase
      .from('operator_trip_overview')
      .select('departure_delay_minutes, actual_departure_at')
      .eq('id', tripId)
      .single()
  ).data;
  check(
    'the trip carries a departure delay derived from both timestamps',
    typeof overview?.departure_delay_minutes === 'number' && Boolean(overview?.actual_departure_at),
    JSON.stringify(overview),
  );

  const undeparted = (
    await cherry.supabase
      .from('operator_trip_overview')
      .select('departure_delay_minutes')
      .is('actual_departure_at', null)
      .limit(1)
  ).data?.[0];
  check(
    'a trip that has not departed has a null delay, not a zero',
    undeparted === undefined || undeparted.departure_delay_minutes === null,
    JSON.stringify(undeparted),
  );

  const paxDash = await passenger.supabase.rpc('operator_dashboard', {});
  check('a passenger still cannot read the dashboard', Boolean(paxDash.error), 'the call succeeded');
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
