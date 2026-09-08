import { Stack } from 'expo-router';

import { AuthGate } from '@/components/common/auth-gate';

/** The booking funnel: search → trip → passengers → seats → payment → done. */
export default function BookingLayout() {
  return (
    <AuthGate>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthGate>
  );
}
