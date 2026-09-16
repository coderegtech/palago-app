// Environment variables the app validates at startup. Real values come from
// `.env`; tests get deterministic placeholders so importing `@/lib/env` in a
// test never depends on the developer's local Supabase instance.
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'test-publishable-key';
process.env.EXPO_PUBLIC_PAYMENT_PROVIDER ??= 'mock';
process.env.EXPO_PUBLIC_WEB_PAYMENT_BASE_URL ??= 'http://127.0.0.1:8090';
process.env.EXPO_PUBLIC_MAP_STYLE_URL ??= 'https://tiles.openfreemap.org/styles/liberty';

// AsyncStorage is a native module, so requiring it throws under Jest. The
// package ships its own mock for exactly this; registering it here rather than
// in each test is what makes anything importing `@/lib/supabase` testable at
// all — the Supabase client reaches for it at module scope, so the whole of
// `services/` and `hooks/` was previously unreachable from a unit test, which
// is most of why their coverage was near zero.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
