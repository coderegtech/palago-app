import '@/global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AppProviders } from '@/providers/app-providers';
import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
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
