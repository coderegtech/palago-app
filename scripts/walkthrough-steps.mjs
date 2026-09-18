/**
 * The shot list for docs/walkthrough.md.
 *
 * Kept apart from `capture-walkthrough.mjs` so the plumbing stays plumbing and
 * this file reads like the document it produces: four journeys, in the order
 * somebody would actually take them.
 *
 * Every step signs in and clicks through. Nothing is rendered in isolation —
 * a screenshot of a screen nobody can reach is worse than no screenshot.
 */

/**
 * Runs a step, says what went wrong, and carries on with the rest.
 *
 * One broken step must not cost the other thirty: a half-finished shot list is
 * far more useful than an exception, and the `!!` lines say exactly which
 * pictures are missing and why.
 *
 * `WALKTHROUGH_ONLY=passenger,operator` narrows the run while iterating.
 */
const ONLY = (process.env.WALKTHROUGH_ONLY ?? '')
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean);

let journey = '';
const wants = (name) => ONLY.length === 0 || ONLY.includes(name);

async function step(name, fn) {
  if (!wants(journey)) return;
  try {
    await fn();
  } catch (error) {
    console.log(`  !! ${name}: ${error.message}`);
  }
}

export async function capture(page, { DEVICE, DESKTOP, sleep }) {
  // -------------------------------------------------------------------------
  journey = 'passenger';
  if (wants(journey)) console.log('\nPassenger');
  // -------------------------------------------------------------------------
  await page.device(DEVICE);

  await step('sign-in', async () => {
    await page.signOut();
    await page.shot('01-sign-in');
  });

  await step('home', async () => {
    await page.signIn('passenger@palago.test');
    await page.waitFor('Where are you travelling');
    await page.shot('02-home');
  });

  await step('search', async () => {
    await page.go('/booking/search');
    await page.waitFor('Search trips');
    await page.shot('03-search');
  });

  await step('results', async () => {
    await page.click('Select origin');
    await page.click('Puerto Princesa');
    await page.click('Select destination');
    await page.click('El Nido');
    await page.click('Search buses');
    await page.waitFor('Cherry Bus', 20_000);
    await page.shot('04-results');
  });

  await step('trip-details', async () => {
    // The first result card, whatever it happens to be today — the seed dates
    // its trips relative to `now()`, so their numbers change daily.
    await page.clickFirstResult();
    await page.waitFor('Enter passenger details', 15_000);
    await page.shot('05-trip-details');
  });

  await step('passengers', async () => {
    await page.click('Enter passenger details');
    await page.waitFor('Full name', 15_000);
    await page.shot('06-passenger-details');
  });

  await step('payment', async () => {
    await page.fill('Juan Dela Cruz', 'Juan Dela Cruz');
    await page.fill('0917 123 4567', '09171234567');
    await page.click('Continue to payment');
    await page.waitFor('Pay', 20_000);
    await page.shot('07-payment');
  });

  await step('wallet', async () => {
    await page.go('/wallet');
    await page.waitFor('Wallet');
    await page.shot('10-wallet');
  });

  await step('rewards', async () => {
    await page.go('/rewards');
    await page.waitFor('Points');
    await page.shot('11-rewards');
  });

  await step('tickets', async () => {
    await page.go('/bookings');
    await page.waitFor('ticket', 15_000);
    await page.shot('08-tickets');
  });

  await step('ticket-detail', async () => {
    await page.click('PPS');
    await sleep(2500);
    await page.shot('09-boarding-pass');
  });

  await step('tracking', async () => {
    await page.go('/tracking');
    await sleep(3000);
    await page.shot('12-tracking');
  });

  await step('sos', async () => {
    await page.go('/sos');
    await page.waitFor('Emergency');
    await page.shot('13-sos');
  });

  await step('discount', async () => {
    await page.go('/discount');
    await sleep(2500);
    await page.shot('14-discount');
  });

  await step('notifications', async () => {
    await page.go('/notifications');
    await sleep(2500);
    await page.shot('15-notifications');
  });

  // -------------------------------------------------------------------------
  journey = 'operator';
  if (wants(journey)) console.log('\nOperator');
  // -------------------------------------------------------------------------
  await page.device(DESKTOP);

  await step('operator-dashboard', async () => {
    await page.signIn('operator@palago.test');
    await page.waitFor('Passengers booked', 20_000);
    await page.shot('20-operator-dashboard');
  });

  await step('schedule', async () => {
    await page.go('/trips');
    await page.waitFor('Departure', 15_000);
    await page.shot('21-operator-schedule');
  });

  await step('schedule-form', async () => {
    await page.click('Schedule a departure');
    await page.waitFor('Trip number');
    await page.shot('22-schedule-form');
    await page.click('Cancel');
  });

  await step('drivers', async () => {
    await page.go('/drivers');
    await page.waitFor('Account status', 15_000);
    await page.shot('23-drivers');
  });

  await step('set-unavailable', async () => {
    await page.click('Set unavailable');
    await page.waitFor('keep their access');
    await page.shot('24-set-unavailable');
    await page.click('Cancel');
  });

  await step('fleet', async () => {
    await page.go('/buses');
    await page.waitFor('Coach', 15_000);
    await page.shot('25-operator-fleet');
  });

  await step('travel-data', async () => {
    await page.go('/travel-data');
    await sleep(3000);
    await page.shot('26-travel-data');
  });

  await step('scanner', async () => {
    await page.go('/scanner');
    await sleep(3000);
    await page.shot('27-scanner');
  });

  await step('counter-sale', async () => {
    await page.go('/assisted-booking');
    await page.waitFor('Travel date', 15_000);
    await page.shot('28-counter-sale');
  });

  // The same passenger card the app uses — see components/booking/passenger-fields.tsx.
  await step('counter-passenger-form', async () => {
    await page.click('Sell on this trip');
    await page.waitFor('Email (optional)', 15_000);
    await page.fill('Juan Dela Cruz', 'Anthony Concepcion');
    await page.fill('0917 123 4567', '09480154134');
    await page.fill('you@example.com', 'anthony@example.com');
    await page.shot('29-counter-passenger-form');
  });

  // -------------------------------------------------------------------------
  journey = 'admin';
  if (wants(journey)) console.log('\nAdmin');
  // -------------------------------------------------------------------------
  await step('admin-overview', async () => {
    await page.signIn('admin@palago.test');
    await page.waitFor('Platform overview', 20_000);
    await page.shot('30-admin-overview');
  });

  await step('admin-operators', async () => {
    await page.go('/operators');
    await page.waitFor('Company', 15_000);
    await page.shot('31-admin-operators');
  });

  await step('add-login', async () => {
    await page.click('Add login');
    await page.waitFor('manage this company');
    await page.shot('32-add-operator-login');
  });

  await step('temp-password', async () => {
    // Stamped with the run: an auth user cannot be deleted from a client, so
    // a fixed address works once and then fails with EMAIL_TAKEN forever.
    await page.fill('Cherry Bus Ops', 'Cherry Ops Two');
    await page.fill('ops@example.com', `ops-${Date.now().toString(36)}@palago.test`);
    await page.click('Create account');
    await page.waitFor('Write this down now', 25_000);
    await page.shot('33-temporary-password');
    await page.click('Done');
  });

  await step('admin-schedules', async () => {
    await page.go('/schedules');
    await page.waitFor('Departure', 15_000);
    await page.shot('34-admin-schedules');
  });

  await step('admin-crew', async () => {
    await page.go('/crew');
    await page.waitFor('Availability', 15_000);
    await page.shot('35-admin-crew');
  });

  await step('admin-fleet', async () => {
    await page.go('/fleet');
    await page.waitFor('Coach', 15_000);
    await page.shot('36-admin-fleet');
  });

  await step('admin-routes', async () => {
    await page.go('/routes');
    await sleep(3000);
    await page.shot('37-admin-routes');
  });

  // Provision one and sign straight in with it, so the forced change is shown
  // being unavoidable rather than described as if it were.
  await step('forced-password-change', async () => {
    await page.go('/operators');
    await page.waitFor('Company', 15_000);
    await page.click('Add login');
    await page.waitFor('manage this company');

    const email = `walkthrough-${Date.now().toString(36)}@palago.test`;
    await page.fill('Cherry Bus Ops', 'Walkthrough Operator');
    await page.fill('ops@example.com', email);
    await page.click('Create account');
    await page.waitFor('Temporary password', 25_000);

    const temporary = await page.evaluate(`(() => {
      const lines = document.body.innerText.split('\\n').map((l) => l.trim());
      // The LAST match, not the first: the sheet's own title says
      // "Temporary password" too, and the first one read back the
      // warning heading instead of the password.
      const at = lines.lastIndexOf('Temporary password');
      const value = at >= 0 ? lines[at + 1] : null;
      return /^[A-Za-z2-9]{10,}$/.test(value ?? '') ? value : null;
    })()`);
    if (!temporary) throw new Error('Could not read the temporary password off the sheet');

    await page.device(DEVICE);
    await page.signOut();
    await page.fill('you@example.com', email);
    await page.fill('Your password', temporary);
    await page.click('Sign in');
    await page.waitFor('Choose your password', 20_000);
    await page.shot('38-forced-password-change');
  });

  // -------------------------------------------------------------------------
  journey = 'driver';
  if (wants(journey)) console.log('\nDriver');
  // -------------------------------------------------------------------------
  await page.device(DEVICE);

  await step('driver-duty', async () => {
    await page.signIn('driver@palago.test');
    await sleep(3000);
    await page.shot('40-driver-duty');
  });

  await step('driver-trip', async () => {
    await page.click('PPS');
    await sleep(3000);
    await page.shot('41-driver-trip');
  });

  await step('driver-scan', async () => {
    await page.go('/scan');
    await sleep(3000);
    await page.shot('42-driver-scan');
  });

  // Availability is the driver's own to set; account status stays the operator's.
  await step('driver-availability', async () => {
    await page.go('/crew-account');
    await page.waitFor('Availability', 15_000);
    await page.shot('43-driver-availability');
  });
}
