import { Redirect, Stack } from 'expo-router';

import { homeRouteForRole } from '@/components/common/auth-gate';
import { Loading } from '@/components/ui/states';
import { useAuth } from '@/hooks/use-auth';

/**
 * Auth screens are for signed-out users. Someone who already has a session gets
 * sent to their role's home rather than shown a login form they don't need.
 */
export default function AuthLayout() {
  const { initialized, isAuthenticated, isProfileLoading, role } = useAuth();

  if (!initialized) return <Loading label="Starting PalaGo…" />;

  if (isAuthenticated) {
    if (isProfileLoading) return <Loading label="Loading your account…" />;
    return <Redirect href={homeRouteForRole(role)} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
