/**
 * The single Supabase client for the app.
 *
 * This client only ever holds the *publishable* (anon) key, so everything it
 * can do is bounded by Row Level Security. Privileged work — confirming
 * payments, generating receipts, validating boarding QRs — goes through Edge
 * Functions, never through this client. See docs/security.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

import { env } from '@/lib/env';
import type { Database } from '@/types/database';

const isWeb = Platform.OS === 'web';

export const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    // On web the browser's own localStorage is the right store; AsyncStorage is
    // only meaningful on native.
    storage: isWeb ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Only the web build can receive an OAuth/magic-link fragment in the URL.
    detectSessionInUrl: isWeb,
  },
});
