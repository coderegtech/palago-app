/**
 * Counter sales, wrapped in TanStack Query.
 *
 * Taking the fare moves the booking, the seats, the manifest and the operator's
 * revenue figures, so a successful payment invalidates all of them rather than
 * leaving the clerk looking at a screen that disagrees with the till.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { counterService } from '@/services/counter-service';
import type {
  CounterPassengerInput,
  CounterPaymentResult,
  CounterSale,
  PaymentMethod,
  BookingSource,
} from '@/services/counter-service';
import type { UUID } from '@/types/models';

export function useSellAtCounter() {
  const queryClient = useQueryClient();

  return useMutation<
    CounterSale,
    Error,
    { tripId: UUID; passengers: CounterPassengerInput[]; seatIds: UUID[]; source: BookingSource }
  >({
    mutationFn: (input) => counterService.sell(input),
    onSettled: (_data, _error, variables) => {
      // Whether it succeeded or lost the seats to someone else, the seat map is
      // now out of date.
      queryClient.invalidateQueries({ queryKey: ['trips', 'seats', variables.tripId] });
      queryClient.invalidateQueries({ queryKey: ['operator'] });
    },
  });
}

export function useTakeCounterPayment() {
  const queryClient = useQueryClient();

  return useMutation<CounterPaymentResult, Error, { bookingId: UUID; method: PaymentMethod }>({
    mutationFn: ({ bookingId, method }) => counterService.takePayment(bookingId, method),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operator'] });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

/** The operator's name for a trip, for the ticket header. */
export function useOperatorNameForTrip(tripId: UUID | null) {
  return useQuery({
    queryKey: ['counter', 'operator-name', tripId],
    queryFn: () => counterService.operatorNameForTrip(tripId!),
    enabled: tripId !== null,
    staleTime: 60 * 60_000,
  });
}
