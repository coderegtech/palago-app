/**
 * Validated runtime configuration.
 *
 * `EXPO_PUBLIC_*` variables are inlined by Babel at build time, so each one has
 * to be referenced as a literal `process.env.EXPO_PUBLIC_X` expression —
 * dynamic lookups such as `process.env[name]` are NOT replaced and resolve to
 * undefined on device. That inlining is also why `parseEnv` takes its input as
 * an argument: the literals are frozen into the bundle, so the only way to
 * exercise the validation is to call it with values directly.
 *
 * Validation runs on import and is deliberately strict: a missing Supabase URL
 * should fail loudly at startup rather than surface later as a confusing
 * "fetch failed to undefined/auth/v1/token".
 *
 * Only public values belong here. Service-role keys and signing secrets live in
 * Supabase Edge Function secrets and must never reach the app bundle.
 */

import { z } from 'zod';

export const envSchema = z.object({
  supabaseUrl: z.url({ error: 'EXPO_PUBLIC_SUPABASE_URL must be a valid URL' }),
  supabasePublishableKey: z
    .string()
    .min(1, { error: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required' }),
  paymentProvider: z.literal('mock', {
    error: 'Only the mock payment provider is supported in this build',
  }),
  webPaymentBaseUrl: z.url({
    error: 'EXPO_PUBLIC_WEB_PAYMENT_BASE_URL must be a valid URL',
  }),
  /** MapLibre style JSON. Defaults to OpenFreeMap, which needs no API key. */
  mapStyleUrl: z
    .url({ error: 'EXPO_PUBLIC_MAP_STYLE_URL must be a valid URL' })
    .default('https://tiles.openfreemap.org/styles/liberty'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: unknown): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  • ${issue.message}`).join('\n');
    throw new Error(
      `PalaGo is misconfigured. Copy .env.example to .env and fill it in.\n${issues}`,
    );
  }

  return parsed.data;
}

export const env = parseEnv({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  paymentProvider: process.env.EXPO_PUBLIC_PAYMENT_PROVIDER,
  webPaymentBaseUrl: process.env.EXPO_PUBLIC_WEB_PAYMENT_BASE_URL,
  mapStyleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
});
