import { Stack } from 'expo-router';

import { AuthGate } from '@/components/common/auth-gate';

/** The booking funnel: search → trip → passengers → payment → done. Seats are
 *  assigned server-side once the payment is verified, so there is no seat step. */
export default function BookingLayout() {
  return (
    <AuthGate>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthGate>
  );
}
