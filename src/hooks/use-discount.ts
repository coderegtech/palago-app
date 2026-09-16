/**
 * Verified fare discounts, wrapped in TanStack Query.
 *
 * `useActiveDiscount` is the one the booking flow asks: it answers "does a
 * discount apply to this passenger", and the answer comes from the server so
 * the app can never talk itself into a cheaper fare than the one that will
 * actually be charged.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { discountService } from '@/services/discount-service';
import type {
  DiscountEligibility,
  DiscountKind,
  PickedProof,
} from '@/services/discount-service';
import type { UUID } from '@/types/models';
import { useAuth } from './use-auth';

export const discountKeys = {
  all: ['discount'] as const,
  mine: () => ['discount', 'mine'] as const,
  active: () => ['discount', 'active'] as const,
  pending: () => ['discount', 'pending'] as const,
};

/** The caller's submissions, including rejected ones and why. */
export function useMyDiscountSubmissions() {
  const { isAuthenticated } = useAuth();

  return useQuery<DiscountEligibility[]>({
    queryKey: discountKeys.mine(),
    queryFn: () => discountService.listMine(),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
}

/** What the caller is verified as right now, or null. */
export function useActiveDiscount() {
  const { isAuthenticated } = useAuth();

  return useQuery<DiscountKind | null>({
    queryKey: discountKeys.active(),
    queryFn: () => discountService.activeKind(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

/** The operator's review queue. */
export function usePendingDiscountReviews() {
  const { role } = useAuth();
  const canReview = role === 'OPERATOR_ADMIN' || role === 'SUPER_ADMIN';

  return useQuery<DiscountEligibility[]>({
    queryKey: discountKeys.pending(),
    queryFn: () => discountService.listPending(),
    enabled: canReview,
    staleTime: 15_000,
  });
}

export function useSubmitDiscountProof() {
  const queryClient = useQueryClient();

  return useMutation<DiscountEligibility, Error, { kind: DiscountKind; proof: PickedProof }>({
    mutationFn: ({ kind, proof }) => discountService.submit(kind, proof),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: discountKeys.all });
    },
  });
}

export function useReviewDiscount() {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    { id: UUID; approve: boolean; note?: string; expiresAt?: string }
  >({
    mutationFn: ({ id, approve, note, expiresAt }) =>
      discountService.review(id, approve, { note, expiresAt }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: discountKeys.all });
      // A decision changes what the next booking costs, so the fare the
      // passenger is looking at is now stale.
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}
