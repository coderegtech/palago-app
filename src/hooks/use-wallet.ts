/**
 * Wallet hooks.
 *
 * The balance is server state, so it lives in TanStack Query and is never
 * adjusted optimistically. An optimistic wallet balance is a lie about money:
 * if the debit fails, the passenger has already been shown a smaller number.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { bookingKeys } from '@/hooks/use-trips';
import { walletService } from '@/services/wallet-service';
import type { Centavos, UUID } from '@/types/models';

export const walletKeys = {
  all: ['wallet'] as const,
  summary: () => ['wallet', 'summary'] as const,
  transactions: () => ['wallet', 'transactions'] as const,
};

export function useWallet() {
  return useQuery({
    queryKey: walletKeys.summary(),
    queryFn: () => walletService.getWallet(),
    staleTime: 15_000,
  });
}

export function useWalletTransactions() {
  return useQuery({
    queryKey: walletKeys.transactions(),
    queryFn: () => walletService.listTransactions(),
    staleTime: 15_000,
  });
}

export function useTopUpWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    // The key is generated here rather than in the service, so a React Query
    // retry reuses it and cannot double-credit.
    mutationFn: ({ amount, idempotencyKey }: { amount: Centavos; idempotencyKey: string }) =>
      walletService.topUp(amount, idempotencyKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: walletKeys.all });
    },
  });
}

export function usePayBookingWithWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bookingId: UUID) => walletService.payBooking(bookingId),
    onSuccess: (_result, bookingId) => {
      // The booking, its payment and the wallet all moved. So did the
      // operator's revenue, but that is a different signed-in user's cache.
      queryClient.invalidateQueries({ queryKey: walletKeys.all });
      queryClient.invalidateQueries({ queryKey: bookingKeys.list });
      queryClient.invalidateQueries({ queryKey: bookingKeys.detail(bookingId) });
      queryClient.invalidateQueries({ queryKey: bookingKeys.full(bookingId) });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}
