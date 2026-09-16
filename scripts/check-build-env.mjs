/**
 * Fails an EAS build that would produce an app which cannot start.
 *
 * Wired up as the `eas-build-pre-install` script in package.json, so EAS runs
 * it on the build server before anything is installed or bundled. npm never
 * runs it locally — the name is an EAS hook, not an npm lifecycle event.
 *
 * ## Why this exists
 *
 * `src/lib/env.ts` validates its five `EXPO_PUBLIC_*` values on import and
 * throws if one is missing. That is the right behaviour and it works well on
 * web, where the throw lands in the console. On a release Android build it is
 * invisible: the root layout imports `AppProviders` → `useAuthBootstrap` →
 * `@/lib/supabase` → `@/lib/env`, so the throw happens while the module graph
 * is still evaluating, before React renders and before any error boundary
 * exists to catch it. The splash screen is already held open by
 * `preventAutoHideAsync()`, so the user sees the splash and then the app
 * closes. No message, no crash dialog, nothing in the UI to go on.
 *
 * `.env` is git-ignored (`.gitignore:57`, `.env*`), and EAS uploads only what
 * git tracks, so the values that make the app work on this machine never reach
 * the build server. Without an `env` block or a linked `environment` in
 * eas.json, every one of them inlines as `undefined`.
 *
 * A silent exit on a tester's phone is the worst place to discover that. A
 * failed build with the missing variable named is the cheapest.
 *
 * Dependency-free on purpose: this runs *before* `pnpm install`.
 */

const profile = process.env.EAS_BUILD_PROFILE ?? 'unknown';

/** Only the development profile may point at a machine on the local network. */
const isDevelopment = profile === 'development';

const LOCAL_HOST = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|10\.)/i;

const problems = [];

function read(name, { required = true } = {}) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (required) problems.push(`${name} is not set.`);
    return undefined;
  }
  return value;
}

function mustBeUrl(name, value) {
  if (value === undefined) return;
  try {
    new URL(value);
  } catch {
    problems.push(`${name} is not a URL: ${value}`);
  }
}

/**
 * A localhost URL baked into an APK points at the phone running it, not at the
 * machine that built it — so the app installs, opens and then fails every
 * request. Worth catching here rather than in a bug report.
 */
function mustBeReachableFromAPhone(name, value) {
  if (value === undefined || isDevelopment) return;
  if (LOCAL_HOST.test(value)) {
    problems.push(
      `${name} points at a local address (${value}). ` +
        `Inside an APK that resolves to the phone itself, not to your machine.`,
    );
  }
}

const supabaseUrl = read('EXPO_PUBLIC_SUPABASE_URL');
const publishableKey = read('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
const paymentProvider = read('EXPO_PUBLIC_PAYMENT_PROVIDER');
const webPaymentBaseUrl = read('EXPO_PUBLIC_WEB_PAYMENT_BASE_URL');
// Optional: env.ts defaults it to OpenFreeMap, which needs no key.
const mapStyleUrl = read('EXPO_PUBLIC_MAP_STYLE_URL', { required: false });

mustBeUrl('EXPO_PUBLIC_SUPABASE_URL', supabaseUrl);
mustBeUrl('EXPO_PUBLIC_WEB_PAYMENT_BASE_URL', webPaymentBaseUrl);
mustBeUrl('EXPO_PUBLIC_MAP_STYLE_URL', mapStyleUrl);

mustBeReachableFromAPhone('EXPO_PUBLIC_SUPABASE_URL', supabaseUrl);
mustBeReachableFromAPhone('EXPO_PUBLIC_WEB_PAYMENT_BASE_URL', webPaymentBaseUrl);

// The same guard `src/lib/env.ts` applies, enforced a build earlier. This one
// is a non-negotiable in AGENTS.md, not a configuration preference.
if (paymentProvider !== undefined && paymentProvider !== 'mock') {
  problems.push(
    `EXPO_PUBLIC_PAYMENT_PROVIDER is "${paymentProvider}". This build supports only "mock".`,
  );
}

// A service-role key or a legacy JWT here would ship inside the APK, where
// anyone can read it. The publishable key is the only one that belongs.
if (publishableKey !== undefined && /service_role|^sb_secret_/.test(publishableKey)) {
  problems.push(
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY looks like a secret key. ' +
      'Every EXPO_PUBLIC_* value is inlined into the app bundle and is readable by anyone.',
  );
}

if (problems.length > 0) {
  console.error(`
──────────────────────────────────────────────────────────────────────────
  Stopping the "${profile}" build: this app would not start.

${problems.map((p) => `    • ${p}`).join('\n')}

  Every EXPO_PUBLIC_* value is inlined into the bundle at build time, and
  src/lib/env.ts validates all of them on import. A missing one throws while
  the root layout is still loading — before React renders and before any
  error boundary exists — so the installed app shows the splash screen and
  then closes with no message at all.

  .env is git-ignored, and EAS uploads only what git tracks, so your local
  values never reach the build server. Set them on EAS instead:

    eas env:create --environment ${isDevelopment ? 'development' : profile} \\
      --name EXPO_PUBLIC_SUPABASE_URL \\
      --value https://<project-ref>.supabase.co \\
      --visibility plaintext --non-interactive

  and the same for EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
  EXPO_PUBLIC_WEB_PAYMENT_BASE_URL. eas.json already links each build profile
  to the environment of the same name.

  See docs/deployment.md → "Android builds".
──────────────────────────────────────────────────────────────────────────
`);
  process.exit(1);
}

console.log(
  `Build environment OK for "${profile}": Supabase ${new URL(supabaseUrl).host}, ` +
    `payments ${paymentProvider}, payment links ${new URL(webPaymentBaseUrl).origin}.`,
);
