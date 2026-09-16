import { Redirect, type Href } from 'expo-router';
import { View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Screen } from '@/components/ui/screen';
import { Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { SignOutButton } from '@/components/common/sign-out-button';
import { AccountStatus, UserRole } from '@/constants/enums';
import { useAuth } from '@/hooks/use-auth';
import { usePushRegistration } from '@/hooks/use-push';

/**
 * Where each role lands after signing in.
 *
 * ADMIN goes to the admin console; an admin is not tied to an operator, so the
 * operator console would have nothing to total for them.
 *
 * Roles can only be assigned administratively — nobody self-selects into
 * DRIVER by signing up, and the `manage-staff` function refuses to create an
 * ADMIN at all.
 */
export function homeRouteForRole(role: UserRole | undefined): Href {
  switch (role) {
    case UserRole.OPERATOR_ADMIN:
      return '/(operator)/dashboard';
    case UserRole.DRIVER:
    case UserRole.CREW:
      return '/(driver)/duty';
    case UserRole.SUPER_ADMIN:
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
 * What a deactivated person sees.
 *
 * Deliberately a screen rather than a redirect to the login page. Their session
 * is still valid and their profile still loads — RLS simply answers them
 * nothing — so bouncing them out would look like the app was broken. This says
 * what happened and who to ask.
 */
function DeactivatedAccount() {
  return (
    <Screen scroll>
      <View className="flex-1 justify-center gap-6 py-12">
        <Alert
          tone="danger"
          title="This account has been deactivated"
          message="You cannot use PalaGo until it is activated again. Your trips, tickets and records are all still here — nothing has been deleted."
        />
        <Text variant="body" tone="muted" className="text-center">
          If you think this is a mistake, ask your operator or a PalaGo administrator to activate it.
        </Text>
        <SignOutButton />
      </View>
    </Screen>
  );
}

/**
 * Route guard for a group layout.
 *
 * This is navigation, not authorisation. It stops someone wandering into the
 * wrong tab; it does not stop them reading data. Every table this protects is
 * independently guarded by RLS, and that is what actually enforces access — a
 * deactivated account is refused by `active_uid()` in the policies whether or
 * not this component ever renders.
 *
 * It is also the one place that wraps every signed-in group and nothing public,
 * which is why push registration hangs off it. The root layout deliberately
 * stays free of native permission code — the public payment page renders in
 * that same tree, in a logged-out browser.
 */
export function AuthGate({ allow, children }: AuthGateProps) {
  const { initialized, isAuthenticated, isProfileLoading, profile, role } = useAuth();

  // Before the early returns, as hook rules require. It is inert until there is
  // a signed-in user, and a no-op wherever push is unavailable.
  usePushRegistration();

  // Deciding before the persisted session has been read would bounce a
  // signed-in user to the login screen on every cold start.
  if (!initialized) return <Loading label="Starting PalaGo…" />;

  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;

  if (isProfileLoading) return <Loading label="Loading your account…" />;

  // The door, before anything else: a deactivated account reaches no console.
  if (profile?.accountStatus === AccountStatus.INACTIVE) return <DeactivatedAccount />;

  // A temporary password has to stop working after it has been used once, and
  // this is what makes that stick. `/change-password` lives at the router root,
  // outside every group, so it is not gated by the console it leads to.
  if (profile?.mustChangePassword) return <Redirect href="/change-password" />;

  if (allow && role && !allow.includes(role)) {
    return <Redirect href={homeRouteForRole(role)} />;
  }

  return <>{children}</>;
}
