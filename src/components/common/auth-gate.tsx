import { Redirect, type Href } from 'expo-router';

import { Loading } from '@/components/ui/states';
import { UserRole } from '@/constants/enums';
import { useAuth } from '@/hooks/use-auth';

/**
 * Where each role lands after signing in.
 *
 * DRIVER and ASSISTANT have no dedicated area yet (Phases 7-8), so they are
 * routed to the passenger app rather than into an operator console they are not
 * authorised for. In practice nobody holds those roles yet: roles can only be
 * assigned administratively with the service role.
 */
export function homeRouteForRole(role: UserRole | undefined): Href {
  switch (role) {
    case UserRole.OPERATOR:
      return '/(operator)/dashboard';
    case UserRole.USER:
    case UserRole.ADMIN:
    case UserRole.DRIVER:
    case UserRole.ASSISTANT:
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
