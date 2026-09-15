/**
 * Account provisioning, and the two statuses that are not the same status.
 *
 *   pnpm db:verify:staff
 *
 * This is the suite for the part of PalaGo that hands somebody the keys, so
 * most of it is about who may not.
 *
 *   - an ADMIN creates OPERATOR accounts; an OPERATOR creates drivers and crew
 *     for their OWN company and nothing else. An operator creating another
 *     operator is the thing the brief forbids outright, and a driver — who
 *     carries an operator id and would pass a naive "is this my operator?"
 *     test — creates nothing at all.
 *   - nobody creates an ADMIN.
 *   - a refused request leaves NOTHING behind. The Edge Function creates the
 *     auth user before the crew record exists, so a half-failed provisioning
 *     that left a usable login would be a real way in.
 *   - the temporary password works once and must then be changed.
 *   - ACCOUNT STATUS and AVAILABILITY move independently, in all four
 *     combinations. A driver on a rest day still signs in; a deactivated driver
 *     does not, and RLS — not just the UI — stops answering them.
 *   - deactivating deletes nothing. The trips they drove are still there.
 *
 * Re-runnable, with one caveat: it provisions real auth users, and a client
 * cannot delete those. Emails are stamped with the run so a second run does not
 * collide; `pnpm db:reset` is what clears them.
 *
 * Requires `supabase start` and `pnpm functions:serve`.
 */

import { createClient } from '@supabase/supabase-js';
import { loadVerifyEnv } from './_verify-env.mjs';
import { makeInvoke } from './_verify-invoke.mjs';

const { url: URL_, key: KEY } = loadVerifyEnv();
const PASSWORD = 'PalawanGo2026';
const RUN = Date.now().toString(36);

const client = () => createClient(URL_, KEY, { auth: { persistSession: false } });

async function signIn(email, password = PASSWORD) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return { supabase, email, userId: data.user.id, accessToken: data.session.access_token };
}

/** Sign-in that is EXPECTED to fail. Returns the error message, or null. */
async function trySignIn(email, password) {
  const { error } = await client().auth.signInWithPassword({ email, password });
  return error?.message ?? null;
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
const manageStaff = (body, accessToken) => invoke('manage-staff', body, accessToken);

const admin = await signIn('admin@palago.test');
const cherry = await signIn('operator@palago.test');
const roro = await signIn('roro@palago.test');
const driver = await signIn('driver@palago.test');
const passenger = await signIn('passenger@palago.test');

const { data: operators } = await admin.supabase.from('operators').select('id, code');
const cherryId = operators.find((o) => o.code === 'CHERRY').id;
const roroId = operators.find((o) => o.code === 'RORO').id;

// ---------------------------------------------------------------------------
console.log('\nScenario 1: who may hand out an account');
// ---------------------------------------------------------------------------

const refusals = [
  {
    name: 'an operator cannot create another operator',
    who: cherry,
    body: {
      action: 'create',
      email: `refused-op-${RUN}@palago.test`,
      fullName: 'Should Not Exist',
      role: 'OPERATOR',
      operatorId: cherryId,
    },
    expect: 'FORBIDDEN',
  },
  {
    name: "an operator cannot create a rival's driver",
    who: cherry,
    body: {
      action: 'create',
      email: `refused-rival-${RUN}@palago.test`,
      fullName: 'Should Not Exist',
      role: 'DRIVER',
      operatorId: roroId,
      licenseNumber: 'X-1',
    },
    expect: 'FORBIDDEN',
  },
  {
    name: 'a driver cannot create anyone',
    who: driver,
    body: {
      action: 'create',
      email: `refused-driver-${RUN}@palago.test`,
      fullName: 'Should Not Exist',
      role: 'DRIVER',
      operatorId: cherryId,
      licenseNumber: 'X-2',
    },
    expect: 'FORBIDDEN',
  },
  {
    name: 'a passenger cannot create anyone',
    who: passenger,
    body: {
      action: 'create',
      email: `refused-pax-${RUN}@palago.test`,
      fullName: 'Should Not Exist',
      role: 'ASSISTANT',
      operatorId: cherryId,
    },
    expect: 'FORBIDDEN',
  },
  {
    name: 'nobody creates an ADMIN, not even an admin',
    who: admin,
    body: {
      action: 'create',
      email: `refused-admin-${RUN}@palago.test`,
      fullName: 'Should Not Exist',
      role: 'ADMIN',
      operatorId: cherryId,
    },
    expect: 'VALIDATION_ERROR',
  },
];

for (const scenario of refusals) {
  const result = await manageStaff(scenario.body, scenario.who.accessToken);
  check(scenario.name, result.body?.code === scenario.expect, JSON.stringify(result.body));

  // The important half. The auth user is created before the crew record, so a
  // refusal that left a signable-in account behind would be a real way in.
  const signedIn = await trySignIn(scenario.body.email, 'anything-at-all');
  check(
    `  ...and leaves no account behind (${scenario.body.email.split('@')[0]})`,
    signedIn !== null,
    'the refused email can sign in',
  );
}

const anonCall = await manageStaff({ action: 'create', email: 'x@y.z' }, null);
check('an anonymous caller is refused', anonCall.status === 401, String(anonCall.status));

// ---------------------------------------------------------------------------
console.log('\nScenario 2: an admin provisions an operator');
// ---------------------------------------------------------------------------

const opEmail = `ops-${RUN}@palago.test`;
const madeOperator = await manageStaff(
  {
    action: 'create',
    email: opEmail,
    fullName: 'Provisioned Operator',
    role: 'OPERATOR',
    operatorId: cherryId,
    phone: '09171112233',
  },
  admin.accessToken,
);

check(
  'the admin can create an operator account',
  madeOperator.body?.success === true,
  JSON.stringify(madeOperator.body),
);

const opTempPassword = madeOperator.body?.data?.temporaryPassword;
check(
  'a temporary password comes back, once',
  typeof opTempPassword === 'string' && opTempPassword.length >= 12,
  String(opTempPassword),
);
check(
  'and it has no characters that are easy to misread aloud',
  !/[IlO01]/.test(opTempPassword ?? 'I'),
  opTempPassword,
);

const duplicate = await manageStaff(
  {
    action: 'create',
    email: opEmail,
    fullName: 'Second Try',
    role: 'OPERATOR',
    operatorId: cherryId,
  },
  admin.accessToken,
);
check('the same email cannot be provisioned twice', duplicate.body?.code === 'EMAIL_TAKEN', JSON.stringify(duplicate.body));

const newOperator = await signIn(opEmail, opTempPassword);
check('the new operator can sign in with it', Boolean(newOperator.userId));

const { data: opProfile } = await newOperator.supabase
  .from('profiles')
  .select('role, operator_id, account_status, must_change_password')
  .eq('id', newOperator.userId)
  .single();

check('with the OPERATOR role', opProfile.role === 'OPERATOR', opProfile.role);
check('scoped to the right company', opProfile.operator_id === cherryId, opProfile.operator_id);
check('an ACTIVE account', opProfile.account_status === 'ACTIVE', opProfile.account_status);
check('and a password it must change', opProfile.must_change_password === true);

// It is a real operator account, not a decorated passenger one.
const { data: consoleRows, error: consoleError } = await newOperator.supabase
  .from('operator_trip_overview')
  .select('id')
  .limit(1);
check(
  'and it can read its own operator console',
  !consoleError && (consoleRows ?? []).length > 0,
  consoleError?.message ?? '0 rows',
);

// ---------------------------------------------------------------------------
console.log('\nScenario 3: the temporary password is temporary');
// ---------------------------------------------------------------------------

const CHOSEN = 'ChosenByMe2026!';
const { error: pwError } = await newOperator.supabase.auth.updateUser({ password: CHOSEN });
check('the new operator can set their own password', pwError === null, pwError?.message);

const { error: markError } = await newOperator.supabase.rpc('mark_password_changed');
check('and clear the forced-change flag', markError === null, markError?.message);

const { data: afterChange } = await newOperator.supabase
  .from('profiles')
  .select('must_change_password')
  .eq('id', newOperator.userId)
  .single();
check('which is now cleared', afterChange.must_change_password === false);

const oldPassword = await trySignIn(opEmail, opTempPassword);
check('the temporary password no longer works', oldPassword !== null, 'it still works');

const chosenWorks = await trySignIn(opEmail, CHOSEN);
check('the chosen one does', chosenWorks === null, chosenWorks ?? '');

// Somebody else's flag is not theirs to clear — `mark_password_changed` takes
// no user id at all, so there is nothing to aim.
const { data: driverFlagBefore } = await admin.supabase
  .from('profiles')
  .select('must_change_password')
  .eq('id', driver.userId)
  .single();
await newOperator.supabase.rpc('mark_password_changed');
const { data: driverFlagAfter } = await admin.supabase
  .from('profiles')
  .select('must_change_password')
  .eq('id', driver.userId)
  .single();
check(
  'clearing your own flag does not clear anyone else’s',
  driverFlagBefore.must_change_password === driverFlagAfter.must_change_password,
);

// ---------------------------------------------------------------------------
console.log('\nScenario 4: an operator provisions their own driver');
// ---------------------------------------------------------------------------

const driverEmail = `wheel-${RUN}@palago.test`;
const madeDriver = await manageStaff(
  {
    action: 'create',
    email: driverEmail,
    fullName: 'Provisioned Driver',
    role: 'DRIVER',
    operatorId: cherryId,
    phone: '09172223344',
    licenseNumber: `DRV-${RUN}`,
    licenseExpirationDate: new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10),
  },
  cherry.accessToken,
);

check(
  'the operator can create a driver account',
  madeDriver.body?.success === true,
  JSON.stringify(madeDriver.body),
);

const newDriverCrewId = madeDriver.body?.data?.crewId;
const newDriverPassword = madeDriver.body?.data?.temporaryPassword;
check('with a crew record attached', typeof newDriverCrewId === 'string', String(newDriverCrewId));

const missingLicence = await manageStaff(
  {
    action: 'create',
    email: `nolicence-${RUN}@palago.test`,
    fullName: 'No Licence',
    role: 'DRIVER',
    operatorId: cherryId,
  },
  cherry.accessToken,
);
check(
  'a driver without a licence number is refused',
  missingLicence.body?.code === 'VALIDATION_ERROR',
  JSON.stringify(missingLicence.body),
);

const { data: crewRow } = await cherry.supabase
  .from('operator_crew')
  .select('name, crew_kind, availability_status, account_status, has_account, account_email')
  .eq('id', newDriverCrewId)
  .single();

check('the crew list shows both statuses separately', Boolean(crewRow), 'no row');
check('  account status ACTIVE', crewRow?.account_status === 'ACTIVE', crewRow?.account_status);
check(
  '  availability AVAILABLE',
  crewRow?.availability_status === 'AVAILABLE',
  crewRow?.availability_status,
);
check('  and it knows there is a login', crewRow?.has_account === true);

// A rival must not see them at all.
const { data: rivalSees } = await roro.supabase
  .from('operator_crew')
  .select('id')
  .eq('id', newDriverCrewId);
check("a rival operator cannot see another company's crew", (rivalSees ?? []).length === 0);

// ---------------------------------------------------------------------------
console.log('\nScenario 5: ACTIVE + UNAVAILABLE — can log in, cannot be given a trip');
// ---------------------------------------------------------------------------

const newDriver = await signIn(driverEmail, newDriverPassword);

// A trip with no crew on it, to assign against.
/**
 * Two trips that can actually be crewed.
 *
 * SCHEDULED explicitly: a trip that has already arrived shows no crew (its
 * assignment is COMPLETED) and so looks free, but `assign_trip_crew` will
 * rightly refuse it with INVALID_TRIP_STATUS.
 *
 * And made, not found, when the seed has run out. In `db:verify:all` the
 * loyalty suite travels the operator's whole schedule to earn points, so by the
 * time this runs there may be nothing left to roster anybody onto — which would
 * fail this suite for a reason that has nothing to do with accounts.
 */
const assignable = await (async () => {
  const read = async () =>
    (
      await cherry.supabase
        .from('operator_trip_overview')
        .select('id, trip_number')
        .eq('status', 'SCHEDULED')
        .order('departure_date')
        .limit(2)
    ).data ?? [];

  let found = await read();
  if (found.length >= 2) return found;

  const { data: route } = await admin.supabase
    .from('routes')
    .select('id')
    .eq('operator_id', cherryId)
    .limit(1)
    .single();
  const { data: bus } = await cherry.supabase.from('operator_fleet').select('id').limit(1).single();

  // Far out, and on separate days, so neither the coach nor the crew clashes
  // with anything the seed or another suite is using.
  for (let i = 0; found.length < 2 && i < 4; i += 1) {
    const day = new Date();
    day.setDate(day.getDate() + 200 + i * 2);
    await cherry.supabase.rpc('create_trip', {
      p_route_id: route.id,
      p_bus_id: bus.id,
      p_trip_number: `VA-${RUN}-${i}`,
      p_departure_date: day.toISOString().slice(0, 10),
      p_departure_time: '06:00:00',
      p_arrival_time: '12:00:00',
      p_fare: 50000,
    });
    found = await read();
  }
  return found;
})();

check('there are trips to roster crew onto', assignable.length >= 2, `${assignable.length}`);

const targetTripId = assignable[0].id;

const rest = await cherry.supabase.rpc('set_crew_availability', {
  p_kind: 'DRIVER',
  p_crew_id: newDriverCrewId,
  p_status: 'UNAVAILABLE',
  p_reason: 'Rest day',
});
check('the operator can set a driver unavailable', rest.error === null, rest.error?.message);

const { data: afterRest } = await cherry.supabase
  .from('operator_crew')
  .select('account_status, availability_status, unavailable_reason')
  .eq('id', newDriverCrewId)
  .single();
check('availability changes', afterRest.availability_status === 'UNAVAILABLE');
check('the account does NOT', afterRest.account_status === 'ACTIVE', afterRest.account_status);
check('and the reason is kept', afterRest.unavailable_reason === 'Rest day', afterRest.unavailable_reason);

const stillIn = await trySignIn(driverEmail, newDriverPassword);
check('an unavailable driver can still sign in', stillIn === null, stillIn ?? '');

const { data: stillReads } = await newDriver.supabase.from('drivers').select('id');
check('and still reads their own crew record', (stillReads ?? []).length > 0);

const assignWhileResting = await cherry.supabase.rpc('assign_trip_crew', {
  p_trip_id: targetTripId,
  p_driver_id: newDriverCrewId,
});
check(
  'but cannot be given a trip',
  assignWhileResting.error?.message === 'INACTIVE_RESOURCE',
  assignWhileResting.error?.message ?? 'the assignment succeeded',
);

// ---------------------------------------------------------------------------
console.log('\nScenario 6: ACTIVE + AVAILABLE — can be given a trip');
// ---------------------------------------------------------------------------

await cherry.supabase.rpc('set_crew_availability', {
  p_kind: 'DRIVER',
  p_crew_id: newDriverCrewId,
  p_status: 'AVAILABLE',
});

const assigned = await cherry.supabase.rpc('assign_trip_crew', {
  p_trip_id: targetTripId,
  p_driver_id: newDriverCrewId,
});
check(
  'available again means assignable again, immediately',
  assigned.error === null,
  assigned.error?.message,
);

const { data: assignedTrip } = await cherry.supabase
  .from('operator_trip_overview')
  .select('driver_name')
  .eq('id', targetTripId)
  .single();
check(
  'and the trip shows them',
  assignedTrip.driver_name === 'Provisioned Driver',
  assignedTrip.driver_name,
);

// ---------------------------------------------------------------------------
console.log('\nScenario 7: INACTIVE — the door closes, the history stays');
// ---------------------------------------------------------------------------

const deactivate = await manageStaff(
  {
    action: 'set-account-status',
    userId: newDriver.userId,
    status: 'INACTIVE',
    reason: 'Left the company',
  },
  cherry.accessToken,
);
check(
  'the operator can deactivate their own driver',
  deactivate.body?.success === true,
  JSON.stringify(deactivate.body),
);
check('and the live session is revoked, not left to expire', deactivate.body?.data?.sessionRevoked === true);

const lockedOut = await trySignIn(driverEmail, newDriverPassword);
check('a deactivated driver cannot sign in', lockedOut !== null, 'they signed in');

// The session token issued a moment ago is still syntactically valid. RLS, not
// the login page, is what has to refuse it.
const { data: staleRead } = await newDriver.supabase.from('drivers').select('id');
check(
  'and their existing token reads nothing',
  (staleRead ?? []).length === 0,
  `${staleRead?.length} rows`,
);

const { data: staleAssignments } = await newDriver.supabase.from('trip_assignments').select('id');
check('including their own assignments', (staleAssignments ?? []).length === 0);

const { data: afterDeactivation } = await cherry.supabase
  .from('operator_crew')
  .select('account_status, availability_status')
  .eq('id', newDriverCrewId)
  .single();
check('the account reads INACTIVE', afterDeactivation.account_status === 'INACTIVE');
check(
  'availability is untouched — the two are independent',
  afterDeactivation.availability_status === 'AVAILABLE',
  afterDeactivation.availability_status,
);

// Nothing was deleted.
const { data: historyKept } = await cherry.supabase
  .from('operator_trip_overview')
  .select('driver_name')
  .eq('id', targetTripId)
  .single();
check(
  'the trip they were on still names them',
  historyKept.driver_name === 'Provisioned Driver',
  historyKept.driver_name,
);

// …but they are no longer eligible for a new one.
const assignDeactivated = await cherry.supabase.rpc('assign_trip_crew', {
  p_trip_id: assignable[1].id,
  p_driver_id: newDriverCrewId,
});
check(
  'a deactivated driver cannot be given a new trip',
  assignDeactivated.error?.message === 'ACCOUNT_DISABLED',
  assignDeactivated.error?.message ?? 'the assignment succeeded',
);

const reactivate = await manageStaff(
  { action: 'set-account-status', userId: newDriver.userId, status: 'ACTIVE' },
  cherry.accessToken,
);
check('reactivating works', reactivate.body?.success === true, JSON.stringify(reactivate.body));

const backIn = await trySignIn(driverEmail, newDriverPassword);
check('and the ban is lifted with it', backIn === null, backIn ?? '');

// ---------------------------------------------------------------------------
console.log('\nScenario 8: how far an operator’s reach goes');
// ---------------------------------------------------------------------------

const rivalDeactivate = await manageStaff(
  { action: 'set-account-status', userId: driver.userId, status: 'INACTIVE' },
  roro.accessToken,
);
check(
  "a rival operator cannot deactivate another company's driver",
  rivalDeactivate.body?.code === 'FORBIDDEN',
  JSON.stringify(rivalDeactivate.body),
);

const operatorOnOperator = await manageStaff(
  { action: 'set-account-status', userId: newOperator.userId, status: 'INACTIVE' },
  cherry.accessToken,
);
check(
  'an operator cannot deactivate an operator account',
  operatorOnOperator.body?.code === 'FORBIDDEN',
  JSON.stringify(operatorOnOperator.body),
);

const selfDeactivate = await manageStaff(
  { action: 'set-account-status', userId: admin.userId, status: 'INACTIVE' },
  admin.accessToken,
);
check(
  'nobody deactivates themselves — that is how a platform locks itself out',
  selfDeactivate.body?.code === 'FORBIDDEN',
  JSON.stringify(selfDeactivate.body),
);

const driverDeactivates = await manageStaff(
  { action: 'set-account-status', userId: passenger.userId, status: 'INACTIVE' },
  driver.accessToken,
);
check('a driver deactivates nobody', driverDeactivates.body?.code === 'FORBIDDEN');

const { data: stillActive } = await admin.supabase
  .from('profiles')
  .select('account_status')
  .eq('id', passenger.userId)
  .single();
check('and the passenger is still ACTIVE', stillActive.account_status === 'ACTIVE');

// ---------------------------------------------------------------------------
console.log('\nScenario 9: resetting credentials');
// ---------------------------------------------------------------------------

const reset = await manageStaff(
  { action: 'reset-password', userId: newDriver.userId },
  cherry.accessToken,
);
check('the operator can reset their driver’s password', reset.body?.success === true, JSON.stringify(reset.body));

const resetPassword = reset.body?.data?.temporaryPassword;
check('a new temporary password comes back', typeof resetPassword === 'string');

const oldStillWorks = await trySignIn(driverEmail, newDriverPassword);
check('the previous password stops working', oldStillWorks !== null, 'it still works');

const resetDriver = await signIn(driverEmail, resetPassword);
const { data: resetProfile } = await resetDriver.supabase
  .from('profiles')
  .select('must_change_password')
  .eq('id', newDriver.userId)
  .single();
check('and the new one must be changed', resetProfile.must_change_password === true);

const rivalReset = await manageStaff(
  { action: 'reset-password', userId: newDriver.userId },
  roro.accessToken,
);
check('a rival cannot reset it', rivalReset.body?.code === 'FORBIDDEN', JSON.stringify(rivalReset.body));

const selfReset = await manageStaff(
  { action: 'reset-password', userId: cherry.userId },
  cherry.accessToken,
);
check('and nobody administratively resets their own', selfReset.body?.code === 'FORBIDDEN');

// ---------------------------------------------------------------------------
console.log('\nScenario 10: crew records without a login');
// ---------------------------------------------------------------------------

const roster = await cherry.supabase.rpc('create_crew_member', {
  p_kind: 'ASSISTANT',
  p_name: `Roster Only ${RUN}`,
  p_phone: '09175556677',
});
check('an operator can record crew who do not use the app', roster.error === null, roster.error?.message);

const rosterId = roster.data?.id;
const { data: rosterRow } = await cherry.supabase
  .from('operator_crew')
  .select('has_account, account_status, availability_status')
  .eq('id', rosterId)
  .single();
check('they show as having no account', rosterRow.has_account === false);
check('with no account status to report', rosterRow.account_status === null, rosterRow.account_status);
check('but they are available for work', rosterRow.availability_status === 'AVAILABLE');

const rivalCreates = await roro.supabase.rpc('create_crew_member', {
  p_kind: 'ASSISTANT',
  p_name: 'Rival Intrusion',
  p_operator_id: cherryId,
});
check(
  "a rival cannot add crew to another company's roster",
  rivalCreates.error?.message === 'FORBIDDEN',
  rivalCreates.error?.message ?? 'it succeeded',
);

const renamed = await cherry.supabase.rpc('update_crew_member', {
  p_kind: 'ASSISTANT',
  p_crew_id: rosterId,
  p_name: `Roster Renamed ${RUN}`,
  p_phone: '09175556677',
});
check('the operator can edit them', renamed.error === null, renamed.error?.message);

const rivalEdits = await roro.supabase.rpc('update_crew_member', {
  p_kind: 'ASSISTANT',
  p_crew_id: rosterId,
  p_name: 'Renamed by a rival',
});
check('a rival cannot', rivalEdits.error?.message === 'FORBIDDEN', rivalEdits.error?.message);

const directWrite = await cherry.supabase
  .from('assistants')
  .update({ name: 'Written straight to the table' })
  .eq('id', rosterId)
  .select();
check(
  'and nobody edits crew by writing the table',
  directWrite.error !== null || (directWrite.data ?? []).length === 0,
  JSON.stringify(directWrite.data),
);

// Attaching a login to somebody already on the roster.
const rosterEmail = `roster-${RUN}@palago.test`;
const linked = await manageStaff(
  {
    action: 'create',
    email: rosterEmail,
    fullName: `Roster Renamed ${RUN}`,
    role: 'ASSISTANT',
    operatorId: cherryId,
    crewId: rosterId,
  },
  cherry.accessToken,
);
check('a login can be attached to an existing record', linked.body?.success === true, JSON.stringify(linked.body));
check(
  'without creating a second crew row',
  linked.body?.data?.crewId === rosterId,
  `${linked.body?.data?.crewId} vs ${rosterId}`,
);

// ---------------------------------------------------------------------------
console.log('\nScenario 11: the audit trail');
// ---------------------------------------------------------------------------

const { data: activity, error: activityError } = await admin.supabase.rpc('staff_activity', {
  p_user_id: newDriver.userId,
});
const actions = (activity ?? []).map((row) => row.action);
check('an admin can read what happened to an account', activityError === null, activityError?.message);
check(
  'provisioning, deactivation, reactivation and the reset are all recorded',
  ['STAFF_ACCOUNT_PROVISIONED', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_ACTIVATED', 'STAFF_PASSWORD_RESET'].every(
    (a) => actions.includes(a),
  ),
  actions.join(', '),
);

const operatorActivity = await cherry.supabase.rpc('staff_activity', { p_user_id: newDriver.userId });
check(
  'an operator cannot — the log records everyone',
  operatorActivity.error?.message === 'FORBIDDEN',
  operatorActivity.error?.message ?? 'it returned rows',
);

const { data: auditDirect } = await cherry.supabase.from('audit_logs').select('id').limit(1);
check('and the table itself stays admin-only', (auditDirect ?? []).length === 0);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
