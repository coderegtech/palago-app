import { useMutation, useQuery } from '@tanstack/react-query';

import { passengerProofService } from '@/services/passenger-proof-service';

/**
 * Pick and upload a passenger's ID photo in one step. Resolves to null when the
 * user backs out of the picker — not an error.
 */
export function useUploadPassengerProof() {
  return useMutation({
    mutationKey: ['passenger-proof', 'upload'],
    mutationFn: async () => {
      const picked = await passengerProofService.pick();
      if (!picked) return null;
      return passengerProofService.upload(picked);
    },
  });
}

/** A short-lived link to an attached ID photo. Refetched well inside its 5 minutes. */
export function usePassengerProofUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['passenger-proof', 'url', path],
    queryFn: () => passengerProofService.signedUrl(path as string),
    enabled: Boolean(path),
    staleTime: 2 * 60_000,
    gcTime: 4 * 60_000,
  });
}
