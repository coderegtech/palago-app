/**
 * Operator console queries and mutations.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { StaffStatus } from '@/constants/enums';
import { operatorService } from '@/services/operator-service';
import type { ISODate, UUID } from '@/types/models';

export const operatorKeys = {
  dashboard: (date?: ISODate) => ['operator', 'dashboard', date ?? 'today'] as const,
  trips: (date?: ISODate) => ['operator', 'trips', date ?? 'all'] as const,
  trip: (id: UUID) => ['operator', 'trip', id] as const,
  manifest: (tripId: UUID) => ['operator', 'manifest', tripId] as const,
  drivers: ['operator', 'drivers'] as const,
  assistants: ['operator', 'assistants'] as const,
  buses: ['operator', 'buses'] as const,
};

export function useOperatorDashboard(date?: ISODate) {
  return useQuery({
    queryKey: operatorKeys.dashboard(date),
    queryFn: () => operatorService.getDashboard(date),
    // Boarding counts move minute to minute while a bus is loading.
    staleTime: 20_000,
  });
}

export function useOperatorTrips(date?: ISODate) {
  return useQuery({
    queryKey: operatorKeys.trips(date),
    queryFn: () => operatorService.listTrips(date),
    staleTime: 20_000,
  });
}

export function useOperatorTrip(tripId: UUID | null) {
  return useQuery({
    queryKey: operatorKeys.trip(tripId ?? 'none'),
    queryFn: () => operatorService.getTrip(tripId!),
    enabled: tripId !== null,
  });
}

export function useManifest(tripId: UUID | null) {
  return useQuery({
    queryKey: operatorKeys.manifest(tripId ?? 'none'),
    queryFn: () => operatorService.getManifest(tripId!),
    enabled: tripId !== null,
    // The manifest is what the crew reads at the door as people board.
    staleTime: 10_000,
  });
}

export function useDrivers() {
  return useQuery({ queryKey: operatorKeys.drivers, queryFn: () => operatorService.listDrivers() });
}

export function useAssistants() {
  return useQuery({
    queryKey: operatorKeys.assistants,
    queryFn: () => operatorService.listAssistants(),
  });
}

export function useBuses() {
  return useQuery({ queryKey: operatorKeys.buses, queryFn: () => operatorService.listBuses() });
}

export function useAddDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; licenseNumber: string; phone?: string; operatorId: UUID }) =>
      operatorService.addDriver(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operatorKeys.drivers });
      queryClient.invalidateQueries({ queryKey: ['operator', 'dashboard'] });
    },
  });
}

export function useAddAssistant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; phone?: string; operatorId: UUID }) =>
      operatorService.addAssistant(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operatorKeys.assistants });
      queryClient.invalidateQueries({ queryKey: ['operator', 'dashboard'] });
    },
  });
}

export function useSetCrewStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      kind,
      id,
      status,
    }: {
      kind: 'DRIVER' | 'ASSISTANT';
      id: UUID;
      status: StaffStatus;
    }) =>
      kind === 'DRIVER'
        ? operatorService.setDriverStatus(id, status)
        : operatorService.setAssistantStatus(id, status),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: variables.kind === 'DRIVER' ? operatorKeys.drivers : operatorKeys.assistants,
      });
      queryClient.invalidateQueries({ queryKey: ['operator', 'dashboard'] });
    },
  });
}
