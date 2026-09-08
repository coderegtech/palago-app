import { Redirect } from 'expo-router';

import { homeRouteForRole } from '@/components/common/auth-gate';
import { Loading } from '@/components/ui/states';
import { useAuth } from '@/hooks/use-auth';

/**
 * Entry point. Waits for the persisted session to be read, then sends the user
 * to their role's home or to sign-in.
 *
 * Deciding before `initialized` would bounce a signed-in user to the login
 * screen on every cold start, which is the classic flash-of-login bug.
 */
export default function IndexScreen() {
  const { initialized, isAuthenticated, isProfileLoading, role } = useAuth();

  if (!initialized) return <Loading label="Starting PalaGo…" />;

  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;

  if (isProfileLoading) return <Loading label="Loading your account…" />;

  return <Redirect href={homeRouteForRole(role)} />;
}
