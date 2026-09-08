// Environment variables the app validates at startup. Real values come from
// `.env`; tests get deterministic placeholders so importing `@/lib/env` in a
// test never depends on the developer's local Supabase instance.
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'test-publishable-key';
process.env.EXPO_PUBLIC_PAYMENT_PROVIDER ??= 'mock';
process.env.EXPO_PUBLIC_WEB_PAYMENT_BASE_URL ??= 'http://127.0.0.1:8090';
process.env.EXPO_PUBLIC_MAP_STYLE_URL ??= 'https://tiles.openfreemap.org/styles/liberty';
