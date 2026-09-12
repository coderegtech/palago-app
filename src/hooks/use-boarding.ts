/**
 * Boarding-pass and scanner hooks.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { bookingKeys } from '@/hooks/use-trips';
import { qrService, type BoardingResult, type ScanResult } from '@/services/qr-service';
import type { UUID } from '@/types/models';

export const boardingKeys = {
  pass: (bookingId: UUID) => ['boarding-pass', bookingId] as const,
  scans: (tripId: UUID) => ['qr-scans', tripId] as const,
};

/**
 * The boarding pass for a booking.
 *
 * Only enabled once the caller believes the booking is paid — asking for an
 * unpaid booking is a guaranteed `UNPAID_BOOKING`, and retrying it would be
 * noise. Passes are cached briefly rather than refetched on every glance.
 */
export function useBoardingPass(bookingId: UUID | null, enabled = true) {
  return useQuery({
    queryKey: boardingKeys.pass(bookingId ?? 'none'),
    queryFn: () => qrService.getBoardingPass(bookingId!),
    enabled: enabled && bookingId !== null,
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

/** Checks a scanned ticket against the trip being boarded. Changes nothing. */
export function useValidateScan() {
  return useMutation<ScanResult, Error, { payload: string; tripId: UUID }>({
    mutationFn: ({ payload, tripId }) => qrService.validateScan(payload, tripId),
  });
}

export function useConfirmBoarding() {
  const queryClient = useQueryClient();

  return useMutation<
    BoardingResult,
    Error,
    { payload: string; tripId: UUID; passengerIds?: UUID[] }
  >({
    mutationFn: ({ payload, tripId, passengerIds }) =>
      qrService.confirmBoarding(payload, tripId, passengerIds),
    onSuccess: () => {
      // Boarding moves booking status, the manifest and the dashboard counts.
      queryClient.invalidateQueries({ queryKey: bookingKeys.list });
      queryClient.invalidateQueries({ queryKey: ['qr-scans'] });
      queryClient.invalidateQueries({ queryKey: ['operator'] });
    },
  });
}

export function useTripScans(tripId: UUID | null) {
  return useQuery({
    queryKey: boardingKeys.scans(tripId ?? 'none'),
    queryFn: () => qrService.listScans(tripId!),
    enabled: tripId !== null,
  });
}
