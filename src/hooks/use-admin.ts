/**
 * Admin console hooks.
 *
 * Reference data changes rarely, so these are cached generously. Every create
 * invalidates the dashboard as well as its own list — adding a bus moves the
 * fleet count on the analytics screen, and an admin who cannot see that happen
 * will add it twice.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminService,
  type CreateBusInput,
  type CreateOperatorInput,
  type CreateRouteInput,
  type CreateTerminalInput,
} from '@/services/admin-service';
import { systemService } from '@/services/system-service';
import type { OperatorStatus } from '@/constants/enums';
import type { ISODate } from '@/types/models';

export const adminKeys = {
  all: ['admin'] as const,
  dashboard: (date?: ISODate) => ['admin', 'dashboard', date ?? 'today'] as const,
  operators: () => ['admin', 'operators'] as const,
  terminals: () => ['admin', 'terminals'] as const,
  routes: () => ['admin', 'routes'] as const,
  buses: () => ['admin', 'buses'] as const,
  staff: (operatorId: string) => ['admin', 'staff', operatorId] as const,
};

export function useAdminDashboard(date?: ISODate) {
  return useQuery({
    queryKey: adminKeys.dashboard(date),
    queryFn: () => adminService.getDashboard(date),
    staleTime: 30_000,
  });
}

export function useAdminOperators() {
  return useQuery({
    queryKey: adminKeys.operators(),
    queryFn: () => adminService.listOperators(),
    staleTime: 60_000,
  });
}

export function useAdminTerminals() {
  return useQuery({
    queryKey: adminKeys.terminals(),
    queryFn: () => adminService.listTerminals(),
    staleTime: 60_000,
  });
}

export function useAdminRoutes() {
  return useQuery({
    queryKey: adminKeys.routes(),
    queryFn: () => adminService.listRoutes(),
    staleTime: 60_000,
  });
}

export function useAdminBuses() {
  return useQuery({
    queryKey: adminKeys.buses(),
    queryFn: () => adminService.listBuses(),
    staleTime: 60_000,
  });
}

export function useAdminStaff(operatorId: string | null) {
  return useQuery({
    queryKey: adminKeys.staff(operatorId ?? 'none'),
    queryFn: () => adminService.listStaff(operatorId!),
    enabled: operatorId !== null,
  });
}

/**
 * Everything one reference-data change can move.
 *
 * Wider than it looks necessary, deliberately: deactivating a bus changes what
 * the schedule screen may roster and what trip search may show, and a stale
 * list is how somebody schedules a coach that is off the road.
 */
function useRefreshAdmin() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['operator'] });
    void queryClient.invalidateQueries({ queryKey: ['schedule'] });
    void queryClient.invalidateQueries({ queryKey: ['trips'] });
  };
}

export function useUpdateOperator() {
  const refresh = useRefreshAdmin();
  return useMutation({
    mutationFn: ({
      operatorId,
      ...input
    }: { operatorId: string } & Omit<CreateOperatorInput, 'code'>) =>
      adminService.updateOperator(operatorId, input),
    onSuccess: refresh,
  });
}

export function useSetOperatorStatus() {
  const refresh = useRefreshAdmin();
  return useMutation({
    mutationFn: ({
      operatorId,
      status,
      reason,
    }: {
      operatorId: string;
      status: OperatorStatus;
      reason?: string;
    }) => adminService.setOperatorStatus(operatorId, status, reason),
    onSuccess: refresh,
  });
}

export function useUpdateTerminal() {
  const refresh = useRefreshAdmin();
  return useMutation({
    mutationFn: ({
      terminalId,
      ...input
    }: { terminalId: string } & Omit<CreateTerminalInput, 'code'>) =>
      adminService.updateTerminal(terminalId, input),
    onSuccess: refresh,
  });
}

export function useSetTerminalStatus() {
  const refresh = useRefreshAdmin();
  return useMutation({
    mutationFn: ({ terminalId, status }: { terminalId: string; status: OperatorStatus }) =>
      adminService.setTerminalStatus(terminalId, status),
    onSuccess: refresh,
  });
}

export function useUpdateRoute() {
  const refresh = useRefreshAdmin();
  return useMutation({
    mutationFn: ({
      routeId,
      ...input
    }: {
      routeId: string;
      durationMinutes: number;
      distanceKm?: number | null;
    }) => adminService.updateRoute(routeId, input),
    onSuccess: refresh,
  });
}

export function useSetRouteStatus() {
  const refresh = useRefreshAdmin();
  return useMutation({
    mutationFn: ({ routeId, status }: { routeId: string; status: OperatorStatus }) =>
      adminService.setRouteStatus(routeId, status),
    onSuccess: refresh,
  });
}

export function useCreateOperator() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOperatorInput) => adminService.createOperator(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
  });
}

export function useCreateTerminal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTerminalInput) => adminService.createTerminal(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
  });
}

export function useCreateRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRouteInput) => adminService.createRoute(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
  });
}

export function useCreateBus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBusInput) => adminService.createBus(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
  });
}

// ---------------------------------------------------------------------------
// Data reset
// ---------------------------------------------------------------------------

/**
 * What a reset would delete and keep. Fetched only while the confirmation
 * dialog is open, and never cached: the numbers are the admin's last look at
 * the data before it goes, so a stale count would be the wrong thing to show.
 */
export function useDataResetPreview(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'data-reset-preview'],
    queryFn: () => systemService.resetPreview(),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Runs the reset. On success every cached query is dropped, not just the
 * admin's — bookings, wallets, notifications and dashboards across the app all
 * describe data that no longer exists.
 */
export function useResetData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (confirmation: string) => systemService.resetData(confirmation),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
