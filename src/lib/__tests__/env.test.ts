import { env, parseEnv } from '@/lib/env';

const valid = {
  supabaseUrl: 'http://127.0.0.1:54321',
  supabasePublishableKey: 'test-publishable-key',
  paymentProvider: 'mock',
  webPaymentBaseUrl: 'http://127.0.0.1:8090',
};

describe('parseEnv', () => {
  it('accepts a valid configuration', () => {
    expect(parseEnv(valid)).toMatchObject(valid);
  });

  it('falls back to the key-free OpenFreeMap style when none is configured', () => {
    expect(parseEnv(valid).mapStyleUrl).toBe('https://tiles.openfreemap.org/styles/liberty');
  });

  it('accepts a custom map style URL', () => {
    const custom = 'https://api.maptiler.com/maps/streets-v2/style.json?key=abc';
    expect(parseEnv({ ...valid, mapStyleUrl: custom }).mapStyleUrl).toBe(custom);
  });

  it('rejects a map style that is not a URL', () => {
    expect(() => parseEnv({ ...valid, mapStyleUrl: 'liberty' })).toThrow(
      /EXPO_PUBLIC_MAP_STYLE_URL/,
    );
  });

  it('rejects a missing Supabase URL', () => {
    expect(() => parseEnv({ ...valid, supabaseUrl: undefined })).toThrow(
      /EXPO_PUBLIC_SUPABASE_URL/,
    );
  });

  it('rejects a Supabase URL that is not a URL', () => {
    expect(() => parseEnv({ ...valid, supabaseUrl: 'not-a-url' })).toThrow(
      /EXPO_PUBLIC_SUPABASE_URL/,
    );
  });

  it('rejects an empty publishable key', () => {
    expect(() => parseEnv({ ...valid, supabasePublishableKey: '' })).toThrow(
      /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  it('rejects any payment provider other than mock', () => {
    // Guard rail: this build must never be pointed at a real payment provider.
    for (const provider of ['stripe', 'gcash', 'maya', 'MOCK']) {
      expect(() => parseEnv({ ...valid, paymentProvider: provider })).toThrow(
        /mock payment provider/,
      );
    }
  });
});

describe('env', () => {
  it('resolves at import time from the build-inlined variables', () => {
    expect(env.paymentProvider).toBe('mock');
    expect(env.supabaseUrl).toMatch(/^https?:\/\//);
  });
});
