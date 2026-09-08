import { Stack } from 'expo-router';

import { AuthGate } from '@/components/common/auth-gate';

export default function BookingDetailLayout() {
  return (
    <AuthGate>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthGate>
  );
}
