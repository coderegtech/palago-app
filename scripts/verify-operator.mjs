/**
 * Operator console read model and crew management.
 *
 *   pnpm db:verify:operator
 *
 * The thing this suite exists for: `trips` is readable by every signed-in user
 * (trip search needs it), so nothing about RLS alone keeps one operator's
 * revenue away from another. The scoping lives inside the Phase 7 views, and
 * that is exactly the kind of claim worth proving rather than trusting.
 *
 * Also checks the dashboard's numbers against reality by driving a real booking
 * through payment and boarding, then asserting the totals moved correctly.
 *
 * Requires `supabase start`.
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

const invoke = makeInvoke(URL_, KEY);

const passenger = await signIn('passenger@palago.test');
const cherry = await signIn('operator@palago.test');
const roro = await signIn('roro@palago.test');
const driver = await signIn('driver@palago.test');
const admin = await signIn('admin@palago.test');

async function releaseAllHolds() {
  const { data: open } = await admin.supabase
    .from('bookings')
    .select('id')
    .in('status', ['PENDING', 'PAYMENT_PENDING']);
  for (const b of open ?? []) {
    await admin.supabase.rpc('cancel_booking', { p_booking_id: b.id });
  }
}
await releaseAllHolds();

// ---------------------------------------------------------------------------
console.log('\nCross-operator isolation — the reason these views exist');
// ---------------------------------------------------------------------------
{
  const cherryTrips = (await cherry.supabase.from('operator_trip_overview').select('trip_number'))
    .data ?? [];
  const roroTrips = (await roro.supabase.from('operator_trip_overview').select('trip_number'))
    .data ?? [];

  const prefixes = (rows) => [...new Set(rows.map((r) => r.trip_number.split('-')[0]))];

  check('Cherry sees trips', cherryTrips.length > 0, `${cherryTrips.length}`);
  check(
    'and only its OWN trips',
    prefixes(cherryTrips).length === 1 && prefixes(cherryTrips)[0] === 'CHERRY',
    prefixes(cherryTrips).join(', '),
  );
  check(
    'RoRo sees only its own trips',
    prefixes(roroTrips).length === 1 && prefixes(roroTrips)[0] === 'RORO',
    prefixes(roroTrips).join(', '),
  );

  // The check that matters: no caller-side filter, yet no leak.
  const paxTrips = (await passenger.supabase.from('operator_trip_overview').select('id')).data ?? [];
  check(
    'a passenger sees NOTHING in the operator overview',
    paxTrips.length === 0,
    `saw ${paxTrips.length} rows`,
  );

  const paxManifest = (await passenger.supabase.from('operator_manifest').select('id')).data ?? [];
  check(
    'a passenger sees nothing in the manifest view, even their own bookings',
    paxManifest.length === 0,
    `saw ${paxManifest.length} rows`,
  );

  const anonTrips = (await client().from('operator_trip_overview').select('id')).data ?? [];
  check('an anonymous caller sees nothing', anonTrips.length === 0, `saw ${anonTrips.length}`);

  // The fleet screen read `buses` directly at first. `buses` is world-readable
  // so trip search can show type and capacity, so a Cherry account was shown
  // RoRo's coaches. Fixed by `operator_fleet`; asserted here so it stays fixed.
  const cherryFleet = (await cherry.supabase.from('operator_fleet').select('bus_number')).data ?? [];
  const roroFleet = (await roro.supabase.from('operator_fleet').select('bus_number')).data ?? [];
  const busPrefixes = (rows) => [...new Set(rows.map((r) => r.bus_number.split('-')[0]))];

  check('Cherry sees its own buses', cherryFleet.length > 0, `${cherryFleet.length}`);
  check(
    'and no RoRo coaches',
    busPrefixes(cherryFleet).length === 1 && busPrefixes(cherryFleet)[0] === 'CB',
    busPrefixes(cherryFleet).join(', '),
  );
  check(
    'RoRo sees only RoRo coaches',
    busPrefixes(roroFleet).length === 1 && busPrefixes(roroFleet)[0] === 'RB',
    busPrefixes(roroFleet).join(', '),
  );
  const paxFleet = (await passenger.supabase.from('operator_fleet').select('id')).data ?? [];
  check('a passenger sees no fleet at all', paxFleet.length === 0, `saw ${paxFleet.length}`);

  const driverTrips = (await driver.supabase.from('operator_trip_overview').select('trip_number'))
    .data ?? [];
  check(
    "a driver sees their own operator's trips",
    driverTrips.length > 0 && prefixes(driverTrips)[0] === 'CHERRY',
    `${driverTrips.length} rows, ${prefixes(driverTrips).join(', ')}`,
  );
}

// ---------------------------------------------------------------------------
console.log('\nDashboard authorisation');
// ---------------------------------------------------------------------------
{
  const pax = await passenger.supabase.rpc('operator_dashboard');
  check(
    'a passenger cannot call operator_dashboard',
    pax.error?.message === 'FORBIDDEN',
    pax.error?.message ?? 'the call succeeded',
  );

  const anon = await client().rpc('operator_dashboard');
  check('an anonymous caller cannot either', Boolean(anon.error), 'the call succeeded');

  const op = await cherry.supabase.rpc('operator_dashboard');
  check('an operator can', !op.error && op.data?.scope === 'OPERATOR', op.error?.message);

  const drv = await driver.supabase.rpc('operator_dashboard');
  check('so can their driver', !drv.error && drv.data?.scope === 'OPERATOR', drv.error?.message);

  const adm = await admin.supabase.rpc('operator_dashboard');
  check(
    'an admin with no operator gets NO_OPERATOR rather than everything',
    adm.data?.scope === 'NO_OPERATOR',
    adm.data?.scope ?? adm.error?.message,
  );

  // Revenue is the figure worth being paranoid about.
  const cherryRevenue = op.data?.today?.revenue;
  const roroDash = await roro.supabase.rpc('operator_dashboard');
  check(
    'each operator gets its own revenue figure',
    typeof cherryRevenue === 'number' && typeof roroDash.data?.today?.revenue === 'number',
    `${cherryRevenue} / ${roroDash.data?.today?.revenue}`,
  );
}

// ---------------------------------------------------------------------------
console.log('\nDashboard numbers track reality');
// ---------------------------------------------------------------------------
{
  const before = (await cherry.supabase.rpc('operator_dashboard')).data.today;

  // A real booking on a Cherry trip departing today, carried through payment.
  const { data: todayTrips } = await cherry.supabase
    .from('operator_trip_overview')
    .select('id, fare')
    .eq('departure_date', before ? (await cherry.supabase.rpc('operator_dashboard')).data.date : null)
    .limit(1);

  if (!todayTrips || todayTrips.length === 0) {
    check('a Cherry trip departs today (seed data)', false, 'none found');
  } else {
    const trip = todayTrips[0];
    const booking = await passenger.supabase.rpc('create_booking', {
      p_trip_id: trip.id,
      p_passengers: [0, 1].map((i) => ({
        name: i === 0 ? 'Manifest Test' : 'Manifest Two',
        phone: '09171234567',
        email: null,
        type: 'ADULT',
      })),
    });
    check('a booking can be made on a Cherry trip', !booking.error, booking.error?.message);

    const created = await invoke(
      'create-test-payment',
      { bookingId: booking.data.bookingId },
      passenger.accessToken,
    );
    const payToken = new URL(created.body.data.paymentUrl).searchParams.get('t');
    await invoke('confirm-test-payment', { reference: created.body.data.reference, token: payToken });

    const after = (await cherry.supabase.rpc('operator_dashboard')).data.today;

    check(
      'passenger count rose by 2',
      after.passengers === (before?.passengers ?? 0) + 2,
      `${before?.passengers} -> ${after.passengers}`,
    );
    check(
      'revenue rose by the fare x 2',
      after.revenue === (before?.revenue ?? 0) + trip.fare * 2,
      `${before?.revenue} -> ${after.revenue}, fare ${trip.fare}`,
    );
    check(
      'seats booked rose by 2',
      after.seatsBooked === (before?.seatsBooked ?? 0) + 2,
      `${before?.seatsBooked} -> ${after.seatsBooked}`,
    );
    check('nobody has boarded yet', after.boarded === (before?.boarded ?? 0), `${after.boarded}`);

    // ---------------------------------------------------------------
    console.log('\nManifest');
    // ---------------------------------------------------------------
    const manifest =
      (
        await cherry.supabase
          .from('operator_manifest')
          .select('passenger_name, seat_number, payment_status, boarded_at, booking_reference')
          .eq('trip_id', trip.id)
      ).data ?? [];

    // Scope every assertion to *this run's* booking reference. Matching on the
    // passenger name would also pick up rows left by an earlier run on the same
    // trip -- which have already been boarded further down -- and the
    // "not yet boarded" check would fail on the second run against one database.
    const mine = manifest.filter((m) => m.booking_reference === booking.data.reference);

    check('the manifest lists both passengers', mine.length === 2, `${mine.length}`);
    check(
      'and shows them as PAID',
      mine.every((m) => m.payment_status === 'PAID'),
      JSON.stringify(mine.map((m) => m.payment_status)),
    );
    check(
      'and not yet boarded',
      mine.every((m) => m.boarded_at === null),
      JSON.stringify(mine.map((m) => m.boarded_at)),
    );

    // RoRo must not see Cherry's manifest.
    const roroPeek =
      (await roro.supabase.from('operator_manifest').select('id').eq('trip_id', trip.id)).data ?? [];
    check(
      "a rival operator cannot read Cherry's manifest",
      roroPeek.length === 0,
      `saw ${roroPeek.length}`,
    );

    // ---------------------------------------------------------------
    console.log('\nBoarding moves the operator view');
    // ---------------------------------------------------------------
    const pass = await invoke(
      'get-boarding-pass',
      { bookingId: booking.data.bookingId },
      passenger.accessToken,
    );
    const qr = JSON.stringify({
      type: 'PALAGO_BOOKING',
      bookingId: pass.body.data.bookingId,
      reference: pass.body.data.reference,
      token: pass.body.data.token,
    });
    // Boarding happens at a named trip, and only once that trip is boarding.
    await cherry.supabase.rpc('set_trip_boarding', { p_trip_id: trip.id });
    const boarded = await invoke('confirm-boarding', { payload: qr, tripId: trip.id }, cherry.accessToken);
    check('the operator can board them', boarded.body?.data?.boarded === true, JSON.stringify(boarded.body));

    const afterBoarding = (await cherry.supabase.rpc('operator_dashboard')).data.today;
    check(
      'the dashboard boarded count rose by 2',
      afterBoarding.boarded === after.boarded + 2,
      `${after.boarded} -> ${afterBoarding.boarded}`,
    );

    const boardedManifest =
      (
        await cherry.supabase
          .from('operator_manifest')
          .select('booking_reference, boarded_at')
          .eq('trip_id', trip.id)
      ).data ?? [];
    const mineBoarded = boardedManifest.filter(
      (m) => m.booking_reference === booking.data.reference,
    );
    check(
      'the manifest now shows them boarded',
      mineBoarded.length === 2 && mineBoarded.every((m) => m.boarded_at !== null),
      JSON.stringify(mineBoarded.map((m) => m.boarded_at)),
    );
  }
}

// ---------------------------------------------------------------------------
console.log('\nCrew management');
// ---------------------------------------------------------------------------
{
  const cherryProfile = (
    await cherry.supabase.from('profiles').select('operator_id').eq('id', cherry.userId).single()
  ).data;
  const roroProfile = (
    await roro.supabase.from('profiles').select('operator_id').eq('id', roro.userId).single()
  ).data;

  const cherryOperatorId = cherryProfile.operator_id;
  const roroOperatorId = roroProfile.operator_id;

  // Crew are written through `create_crew_member` / `update_crew_member` /
  // `set_crew_availability` now, not by writing the table: creating a driver
  // has a second half (an auth account), availability carries a reason, and
  // every change belongs in the audit trail.
  const added = await cherry.supabase.rpc('create_crew_member', {
    p_kind: 'DRIVER',
    p_name: 'Test Driver',
    p_license_number: `DRV-T${Date.now() % 100000}`,
    p_phone: '09170000001',
  });
  check('an operator can add its own driver', !added.error, added.error?.message);

  const directAdd = await cherry.supabase.from('drivers').insert({
    operator_id: cherryOperatorId,
    name: 'Written Straight To The Table',
    license_number: `DRV-D${Date.now() % 100000}`,
  });
  check('but not by writing the table', Boolean(directAdd.error), 'the insert succeeded');

  // The write that must fail: crew under someone else's company.
  const crossAdd = await cherry.supabase.rpc('create_crew_member', {
    p_kind: 'DRIVER',
    p_name: 'Planted Driver',
    p_license_number: `DRV-X${Date.now() % 100000}`,
    p_operator_id: roroOperatorId,
  });
  check(
    "an operator cannot add a driver to a rival's roster",
    crossAdd.error?.message === 'FORBIDDEN',
    crossAdd.error?.message ?? 'it succeeded',
  );

  const roroDriver = (
    await roro.supabase.from('drivers').select('id').eq('operator_id', roroOperatorId).limit(1)
  ).data[0];
  const crossEdit = await cherry.supabase.rpc('set_crew_availability', {
    p_kind: 'DRIVER',
    p_crew_id: roroDriver.id,
    p_status: 'UNAVAILABLE',
  });
  check(
    "an operator cannot make a rival's driver unavailable",
    crossEdit.error?.message === 'FORBIDDEN',
    crossEdit.error?.message ?? 'the change was applied',
  );

  const ownId = added.data?.id;
  const rested = await cherry.supabase.rpc('set_crew_availability', {
    p_kind: 'DRIVER',
    p_crew_id: ownId,
    p_status: 'UNAVAILABLE',
    p_reason: 'Rest day',
  });
  const { data: ownAfter } = await cherry.supabase
    .from('operator_crew')
    .select('availability_status, account_status')
    .eq('id', ownId)
    .single();
  check(
    "an operator can change its own driver's availability",
    !rested.error && ownAfter.availability_status === 'UNAVAILABLE',
    rested.error?.message ?? ownAfter.availability_status,
  );
  // Availability is not account access: this one has no login at all, so there
  // is no account status to have changed.
  check('without touching account access', ownAfter.account_status === null, ownAfter.account_status);

  // No cleanup delete: `drivers` has no client DELETE path any more, and a
  // crew record is history once anything references it. Re-runs simply add a
  // differently-numbered Test Driver, which nothing counts.

  const paxAdd = await passenger.supabase.rpc('create_crew_member', {
    p_kind: 'DRIVER',
    p_name: 'Passenger Driver',
    p_license_number: `DRV-P${Date.now() % 100000}`,
    p_operator_id: cherryOperatorId,
  });
  check(
    'a passenger cannot add crew at all',
    paxAdd.error?.message === 'FORBIDDEN',
    paxAdd.error?.message ?? 'it succeeded',
  );
}

await releaseAllHolds();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
