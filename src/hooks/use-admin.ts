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
import type { ISODate } from '@/types/models';

export const adminKeys = {
  all: ['admin'] as const,
  dashboard: (date?: ISODate) => ['admin', 'dashboard', date ?? 'today'] as const,
  operators: () => ['admin', 'operators'] as const,
  terminals: () => ['admin', 'terminals'] as const,
  routes: () => ['admin', 'routes'] as const,
  buses: () => ['admin', 'buses'] as const,
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
