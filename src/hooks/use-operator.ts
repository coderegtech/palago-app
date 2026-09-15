/**
 * Operator console queries and mutations.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { BusType, OperatorStatus } from '@/constants/enums';
import { operatorService } from '@/services/operator-service';
import type { ISODate, UUID } from '@/types/models';

export const operatorKeys = {
  dashboard: (date?: ISODate) => ['operator', 'dashboard', date ?? 'today'] as const,
  trips: (date?: ISODate) => ['operator', 'trips', date ?? 'all'] as const,
  trip: (id: UUID) => ['operator', 'trip', id] as const,
  manifest: (tripId: UUID) => ['operator', 'manifest', tripId] as const,
  buses: ['operator', 'buses'] as const,
  routes: ['operator', 'routes'] as const,
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

// Crew hooks live in `use-staff`. A driver is a record AND an account with two
// independent statuses, and `drivers` alone shows only one of them.

export function useBuses() {
  return useQuery({ queryKey: operatorKeys.buses, queryFn: () => operatorService.listBuses() });
}

export function useOperatorRoutes() {
  return useQuery({ queryKey: operatorKeys.routes, queryFn: () => operatorService.listRoutes() });
}

/** Everything a fleet change moves: the fleet list, the dashboard, the schedule. */
function useRefreshFleet() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: operatorKeys.buses });
    void queryClient.invalidateQueries({ queryKey: ['operator', 'dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['schedule'] });
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
  };
}

export function useCreateBus() {
  const refresh = useRefreshFleet();

  return useMutation({
    mutationFn: (input: {
      operatorId: UUID;
      plateNumber: string;
      busNumber: string;
      capacity: number;
      busType: BusType;
      name?: string | null;
    }) => operatorService.createBus(input),
    onSuccess: refresh,
  });
}

export function useUpdateBus() {
  const refresh = useRefreshFleet();

  return useMutation({
    mutationFn: (input: {
      busId: UUID;
      busNumber: string;
      plateNumber: string;
      name?: string | null;
      operatorId?: UUID;
    }) => operatorService.updateBus(input),
    onSuccess: refresh,
  });
}

export function useSetBusStatus() {
  const refresh = useRefreshFleet();

  return useMutation({
    mutationFn: ({
      busId,
      status,
      reason,
    }: {
      busId: UUID;
      status: OperatorStatus;
      reason?: string;
    }) => operatorService.setBusStatus(busId, status, reason),
    onSuccess: refresh,
  });
}
