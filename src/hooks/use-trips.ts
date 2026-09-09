/**
 * Trip search and seat-map queries.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { bookingService, type ReservationResult } from '@/services/booking-service';
import { tripService, type TripFilters } from '@/services/trip-service';
import type { PassengerDetailInput, TripSearchInput } from '@/schemas/booking';
import type { UUID } from '@/types/models';

export const tripKeys = {
  operators: ['operators'] as const,
  terminals: ['terminals'] as const,
  search: (input: TripSearchInput, filters: TripFilters) => ['trips', 'search', input, filters] as const,
  trip: (tripId: UUID) => ['trips', tripId] as const,
  seats: (tripId: UUID) => ['trips', tripId, 'seats'] as const,
};

export const bookingKeys = {
  list: ['bookings'] as const,
  detail: (id: UUID) => ['bookings', id] as const,
  full: (id: UUID) => ['bookings', id, 'detail'] as const,
};

export function useOperators() {
  return useQuery({
    queryKey: tripKeys.operators,
    queryFn: () => tripService.listOperators(),
    // Operators change about as often as terminals do.
    staleTime: 60 * 60_000,
  });
}

export function useTerminals() {
  return useQuery({
    queryKey: tripKeys.terminals,
    queryFn: () => tripService.listTerminals(),
    // Terminals change roughly never; refetching them on every search is waste.
    staleTime: 60 * 60_000,
  });
}

export function useTripSearch(
  input: TripSearchInput | null,
  filters: TripFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: input ? tripKeys.search(input, filters) : ['trips', 'search', 'idle'],
    queryFn: () => tripService.searchTrips(input!, filters),
    enabled: enabled && input !== null,
    // Availability moves as other people book, so results go stale quickly.
    staleTime: 15_000,
  });
}

export function useTrip(tripId: UUID | null) {
  return useQuery({
    queryKey: tripKeys.trip(tripId ?? 'none'),
    queryFn: () => tripService.getTrip(tripId!),
    enabled: tripId !== null,
    staleTime: 30_000,
  });
}

export function useTripSeats(tripId: UUID | null) {
  return useQuery({
    queryKey: tripKeys.seats(tripId ?? 'none'),
    queryFn: () => tripService.getTripSeats(tripId!),
    enabled: tripId !== null,
    // The seat map is the most contended data in the app. Phase 8 replaces this
    // interval with a Realtime subscription.
    staleTime: 5_000,
    refetchInterval: 20_000,
  });
}

export function useReserveSeats() {
  const queryClient = useQueryClient();

  return useMutation<
    ReservationResult,
    Error,
    { tripId: UUID; passengers: PassengerDetailInput[] }
  >({
    mutationFn: ({ tripId, passengers }) => bookingService.reserveSeats(tripId, passengers),
    onSettled: (_data, _error, variables) => {
      // Whether it succeeded or lost the race, the seat map is now out of date.
      queryClient.invalidateQueries({ queryKey: tripKeys.seats(variables.tripId) });
      queryClient.invalidateQueries({ queryKey: ['trips', 'search'] });
      queryClient.invalidateQueries({ queryKey: bookingKeys.list });
    },
  });
}

export function useBookings() {
  return useQuery({
    queryKey: bookingKeys.list,
    queryFn: () => bookingService.listBookings(),
  });
}

export function useBooking(bookingId: UUID | null) {
  return useQuery({
    queryKey: bookingKeys.detail(bookingId ?? 'none'),
    queryFn: () => bookingService.getBooking(bookingId!),
    enabled: bookingId !== null,
  });
}

export function useBookingDetail(bookingId: UUID | null) {
  return useQuery({
    queryKey: bookingKeys.full(bookingId ?? 'none'),
    queryFn: () => bookingService.getBookingDetail(bookingId!),
    enabled: bookingId !== null,
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bookingId: UUID) => bookingService.cancelBooking(bookingId),
    onSuccess: (_data, bookingId) => {
      queryClient.invalidateQueries({ queryKey: bookingKeys.list });
      queryClient.invalidateQueries({ queryKey: bookingKeys.detail(bookingId) });
      queryClient.invalidateQueries({ queryKey: bookingKeys.full(bookingId) });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });
}
