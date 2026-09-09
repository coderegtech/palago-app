/**
 * Session bootstrap and the read side of auth.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { UserRole } from '@/constants/enums';
import { ErrorCode } from '@/constants/errors';
import { AppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { authService } from '@/services/auth-service';
import { useAuthStore } from '@/stores/auth-store';
import type { Profile } from '@/types/models';

export const authKeys = {
  profile: (userId: string) => ['profile', userId] as const,
};

/**
 * Mounted once, at the root. Reads the persisted session, then keeps the store
 * in step with supabase-js for the lifetime of the app.
 *
 * This does not gate rendering: the public payment page must display while this
 * is still resolving. Screens that require a session wait on `initialized`
 * themselves, via `AuthGate`.
 */
export function useAuthBootstrap(): void {
  const setSession = useAuthStore((state) => state.setSession);
  const setInitialized = useAuthStore((state) => state.setInitialized);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;

    authService
      .getSession()
      .then((session) => {
        if (active) setSession(session);
      })
      .catch(() => {
        // A session that cannot be read is simply "signed out". Surfacing an
        // error here would block the app on a corrupt token.
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setInitialized(true);
      });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setInitialized(true);

      // Never let one account see the previous account's cached profile.
      if (event === 'SIGNED_OUT') queryClient.clear();
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [setSession, setInitialized, queryClient]);
}

export function useProfile() {
  const userId = useAuthStore((state) => state.session?.user.id);

  const query = useQuery<Profile>({
    queryKey: authKeys.profile(userId ?? 'anonymous'),
    queryFn: () => authService.getProfile(userId!),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    // A missing profile is not a transient failure; retrying cannot fix it.
    retry: (attempt, error) =>
      !(error instanceof AppError && error.code === ErrorCode.NOT_FOUND) && attempt < 2,
  });

  /**
   * A held token whose user no longer exists.
   *
   * The JWT is still well-formed and unexpired, so route guards let the person
   * through, but every query returns nothing and the app dead-ends on
   * confusing "could not load" errors. Signing out converts that into a clean
   * trip back to the login screen.
   *
   * Reachable in production when an account is deleted or a token revoked, and
   * routinely in development after `pnpm db:reset` regenerates every user id.
   */
  useEffect(() => {
    if (
      query.isError &&
      query.error instanceof AppError &&
      query.error.code === ErrorCode.NOT_FOUND
    ) {
      console.warn('Signed-in user has no profile; signing out to clear the stale session.');
      void authService.signOut();
    }
  }, [query.isError, query.error]);

  return query;
}

export interface AuthSnapshot {
  session: ReturnType<typeof useAuthStore.getState>['session'];
  userId: string | undefined;
  email: string | undefined;
  profile: Profile | undefined;
  role: UserRole | undefined;
  isAuthenticated: boolean;
  /** The persisted session has been read; guards may now decide. */
  initialized: boolean;
  /** Signed in, but the profile (and therefore the role) is still loading. */
  isProfileLoading: boolean;
}

export function useAuth(): AuthSnapshot {
  const session = useAuthStore((state) => state.session);
  const initialized = useAuthStore((state) => state.initialized);
  const { data: profile, isPending } = useProfile();

  return {
    session,
    userId: session?.user.id,
    email: session?.user.email,
    profile,
    role: profile?.role,
    isAuthenticated: session !== null,
    initialized,
    isProfileLoading: session !== null && isPending,
  };
}
