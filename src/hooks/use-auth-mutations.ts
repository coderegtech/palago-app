/**
 * The write side of auth. Every mutation surfaces an `AppError`, so screens can
 * branch on `error.code` rather than parsing messages.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { env } from '@/lib/env';
import { authService, type SignUpParams } from '@/services/auth-service';
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
    mutationFn: () => authService.signOut(),
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
