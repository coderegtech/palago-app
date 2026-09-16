import '@/global.css';
// Side effect only, and it has to happen before the first screen mounts —
// see the note at the top of the module.
import '@/lib/observe';

import { ObserveRoot } from 'expo-observe';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AppProviders } from '@/providers/app-providers';
import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

function RootLayout() {
  useEffect(() => {
    // Phase 2 will hold the splash until the persisted session has been read.
    SplashScreen.hideAsync();
  }, []);

  return (
    <AppProviders>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(user)" />
        <Stack.Screen name="(operator)" />
        <Stack.Screen name="booking" />
        <Stack.Screen name="bookings" />
        {/* Both public: reachable without a session, by QR or by email link. */}
        <Stack.Screen name="payment/[reference]" />
        <Stack.Screen name="reset-password" />
      </Stack>
    </AppProviders>
  );
}

/**
 * `ObserveRoot.wrap` starts the session that cold_ttr, warm_ttr and tti are
 * measured against, so it has to sit at the very top of the tree. It renders no
 * UI of its own.
 *
 * TTI is marked per screen rather than here: this layout hides the splash
 * immediately and `index.tsx` only redirects, so "the app is usable" happens on
 * whichever screen the redirect lands on. Those screens render
 * `<ObserveInteractiveMarker />` once their data has arrived.
 */
export default ObserveRoot.wrap(RootLayout);
