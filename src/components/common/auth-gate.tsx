import { Redirect, type Href } from 'expo-router';

import { Loading } from '@/components/ui/states';
import { UserRole } from '@/constants/enums';
import { useAuth } from '@/hooks/use-auth';

/**
 * Where each role lands after signing in.
 *
 * ADMIN goes to the passenger app deliberately: an admin is not tied to an
 * operator, so the operator console has nothing to total for them. A dedicated
 * admin dashboard is out of scope for this build.
 *
 * Roles can only be assigned administratively with the service role — nobody
 * self-selects into DRIVER by signing up.
 */
export function homeRouteForRole(role: UserRole | undefined): Href {
  switch (role) {
    case UserRole.OPERATOR:
      return '/(operator)/dashboard';
    case UserRole.DRIVER:
    case UserRole.ASSISTANT:
      return '/(driver)/duty';
    case UserRole.ADMIN:
      return '/(admin)/overview';
    case UserRole.USER:
    default:
      return '/(user)/home';
  }
}

export interface AuthGateProps {
  /** Roles permitted in this group. Omit to require only a signed-in user. */
  allow?: readonly UserRole[];
  children: React.ReactNode;
}

/**
 * Route guard for a group layout.
 *
 * This is navigation, not authorisation. It stops someone wandering into the
 * wrong tab; it does not stop them reading data. Every table this protects is
 * independently guarded by RLS, and that is what actually enforces access.
 */
export function AuthGate({ allow, children }: AuthGateProps) {
  const { initialized, isAuthenticated, isProfileLoading, role } = useAuth();

  // Deciding before the persisted session has been read would bounce a
  // signed-in user to the login screen on every cold start.
  if (!initialized) return <Loading label="Starting PalaGo…" />;

  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;

  if (isProfileLoading) return <Loading label="Loading your account…" />;

  if (allow && role && !allow.includes(role)) {
    return <Redirect href={homeRouteForRole(role)} />;
  }

  return <>{children}</>;
}
