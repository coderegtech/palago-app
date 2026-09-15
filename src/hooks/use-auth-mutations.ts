/**
 * The write side of auth. Every mutation surfaces an `AppError`, so screens can
 * branch on `error.code` rather than parsing messages.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { env } from '@/lib/env';
import { authService, type SignUpParams } from '@/services/auth-service';
import { pushService } from '@/services/push-service';
import { authKeys } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import type { ProfileInput } from '@/schemas/auth';

export function useSignIn() {
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authService.signIn(email, password),
  });
}

export function useSignUp() {
  return useMutation({
    mutationFn: (params: SignUpParams) => authService.signUp(params),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // Forget this device *before* the session goes: `remove_push_token` runs
      // as the signed-in user, so afterwards there is nobody to authorise it and
      // the handset would keep receiving this passenger's trip alerts.
      //
      // A failure here must not trap somebody in a session they asked to leave,
      // so it is logged and swallowed. The token is reassigned on the next
      // sign-in anyway, and the Edge Function drops tokens Expo reports as no
      // longer registered.
      try {
        const token = await pushService.currentToken();
        if (token) await pushService.unregister(token);
      } catch (error) {
        console.warn('Could not remove this device from push notifications:', error);
      }

      await authService.signOut();
    },
    onSuccess: () => {
      // onAuthStateChange also clears this; doing it here too means the UI does
      // not flash the outgoing account's data while that event propagates.
      queryClient.clear();
    },
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) =>
      authService.requestPasswordReset(
        email,
        `${env.webPaymentBaseUrl}/reset-password`,
      ),
  });
}

export function useUpdatePassword() {
  return useMutation({
    mutationFn: (password: string) => authService.updatePassword(password),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.session?.user.id);

  return useMutation({
    mutationFn: (input: ProfileInput) => authService.updateProfile(userId!, input),
    onSuccess: (profile) => {
      // The server's row is authoritative — write back what it returned rather
      // than what was submitted.
      queryClient.setQueryData(authKeys.profile(profile.id), profile);
    },
  });
}
