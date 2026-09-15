/**
 * Scheduling, wrapped in TanStack Query.
 *
 * Every mutation here can move a trip's bus, its crew, or whether it sells — so
 * each invalidates the operator console, the admin console and the passenger's
 * trip search together. A schedule screen showing a coach as free after it has
 * just been rostered is how a double booking gets attempted.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  scheduleService,
  type CreateTripInput,
  type UpdateTripInput,
} from '@/services/schedule-service';
import type { UUID } from '@/types/models';

export const scheduleKeys = {
  all: ['schedule'] as const,
  trips: ['schedule', 'trips'] as const,
  turnaround: ['schedule', 'turnaround'] as const,
};

export function useAllTrips() {
  return useQuery({
    queryKey: scheduleKeys.trips,
    queryFn: () => scheduleService.listAllTrips(),
    staleTime: 20_000,
  });
}

export function useTurnaroundMinutes() {
  return useQuery({
    queryKey: scheduleKeys.turnaround,
    queryFn: () => scheduleService.turnaroundMinutes(),
    // Configuration. It changes when an admin changes it, not on its own.
    staleTime: 5 * 60_000,
  });
}

function useRefreshSchedule() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['operator'] });
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
    // A cancelled or withdrawn trip must stop appearing in passenger search.
    void queryClient.invalidateQueries({ queryKey: ['trips'] });
  };
}

export function useCreateTrip() {
  const refresh = useRefreshSchedule();
  return useMutation({
    mutationFn: (input: CreateTripInput) => scheduleService.createTrip(input),
    onSuccess: refresh,
  });
}

export function useUpdateTrip() {
  const refresh = useRefreshSchedule();
  return useMutation({
    mutationFn: (input: UpdateTripInput) => scheduleService.updateTrip(input),
    onSuccess: refresh,
  });
}

export function useCancelTrip() {
  const refresh = useRefreshSchedule();
  return useMutation({
    mutationFn: ({ tripId, reason }: { tripId: UUID; reason?: string }) =>
      scheduleService.cancelTrip(tripId, reason),
    onSuccess: refresh,
  });
}

export function useSetTripActive() {
  const refresh = useRefreshSchedule();
  return useMutation({
    mutationFn: ({ tripId, active }: { tripId: UUID; active: boolean }) =>
      scheduleService.setTripActive(tripId, active),
    onSuccess: refresh,
  });
}

export function useAssignCrew() {
  const refresh = useRefreshSchedule();
  return useMutation({
    mutationFn: ({
      tripId,
      driverId,
      assistantId,
    }: {
      tripId: UUID;
      driverId?: UUID | null;
      assistantId?: UUID | null;
    }) => scheduleService.assignCrew(tripId, { driverId, assistantId }),
    onSuccess: refresh,
  });
}

export function useUnassignCrew() {
  const refresh = useRefreshSchedule();
  return useMutation({
    mutationFn: (tripId: UUID) => scheduleService.unassignCrew(tripId),
    onSuccess: refresh,
  });
}

export function useSetTurnaroundMinutes() {
  const refresh = useRefreshSchedule();
  return useMutation({
    mutationFn: (minutes: number) => scheduleService.setTurnaroundMinutes(minutes),
    onSuccess: refresh,
  });
}
