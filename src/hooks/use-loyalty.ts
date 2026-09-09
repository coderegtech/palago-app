/**
 * Loyalty hooks.
 *
 * Like the wallet balance, points are server state and are never adjusted
 * optimistically. Showing a passenger a balance they do not have is the same
 * mistake as showing them money they do not have.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { bookingKeys } from '@/hooks/use-trips';
import { loyaltyService } from '@/services/loyalty-service';
import type { UUID } from '@/types/models';

export const loyaltyKeys = {
  all: ['loyalty'] as const,
  summary: () => ['loyalty', 'summary'] as const,
  transactions: () => ['loyalty', 'transactions'] as const,
  rewards: () => ['loyalty', 'rewards'] as const,
};

export function useLoyalty() {
  return useQuery({
    queryKey: loyaltyKeys.summary(),
    queryFn: () => loyaltyService.getSummary(),
    staleTime: 15_000,
  });
}

export function useLoyaltyTransactions() {
  return useQuery({
    queryKey: loyaltyKeys.transactions(),
    queryFn: () => loyaltyService.listTransactions(),
    staleTime: 15_000,
  });
}

export function useRewards() {
  return useQuery({
    queryKey: loyaltyKeys.rewards(),
    queryFn: () => loyaltyService.listRewards(),
    // The catalogue changes about as often as the terminals do.
    staleTime: 5 * 60_000,
  });
}

/** Everything a redemption moves: the points, and the booking it discounts. */
function useRedemptionInvalidation() {
  const queryClient = useQueryClient();

  return (bookingId: UUID) => {
    queryClient.invalidateQueries({ queryKey: loyaltyKeys.all });
    queryClient.invalidateQueries({ queryKey: bookingKeys.list });
    queryClient.invalidateQueries({ queryKey: bookingKeys.detail(bookingId) });
    queryClient.invalidateQueries({ queryKey: bookingKeys.full(bookingId) });
    // Redeeming cancels any pending QR payment, so its cache is stale too.
    queryClient.invalidateQueries({ queryKey: ['payments'] });
  };
}

export function useRedeemReward() {
  const invalidate = useRedemptionInvalidation();

  return useMutation({
    mutationFn: ({ bookingId, rewardId }: { bookingId: UUID; rewardId: UUID }) =>
      loyaltyService.redeem(bookingId, rewardId),
    onSuccess: (_result, { bookingId }) => invalidate(bookingId),
  });
}

export function useCancelRedemption() {
  const invalidate = useRedemptionInvalidation();

  return useMutation({
    mutationFn: (bookingId: UUID) => loyaltyService.cancelRedemption(bookingId),
    onSuccess: (_result, bookingId) => invalidate(bookingId),
  });
}
