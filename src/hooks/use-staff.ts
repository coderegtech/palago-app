/**
 * Crew and staff accounts, wrapped in TanStack Query.
 *
 * The invalidations here are wider than they look necessary. Changing a
 * driver's availability moves the operator dashboard's crew tile; deactivating
 * an account changes who can be rostered, which the schedule screen reads. A
 * stale number on a management screen is how somebody rosters a driver who is
 * no longer available.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AccountStatus, AvailabilityStatus, CrewKind } from '@/constants/enums';
import { staffService, type CreateCrewInput, type CreateStaffInput } from '@/services/staff-service';
import type { ISODate, UUID } from '@/types/models';

export const staffKeys = {
  all: ['staff'] as const,
  crew: (kind?: CrewKind) => ['staff', 'crew', kind ?? 'all'] as const,
  activity: (userId: UUID) => ['staff', 'activity', userId] as const,
};

export function useCrew(kind?: CrewKind) {
  return useQuery({
    queryKey: staffKeys.crew(kind),
    queryFn: () => staffService.listCrew(kind),
    staleTime: 30_000,
  });
}

export function useStaffActivity(userId: UUID | null) {
  return useQuery({
    queryKey: staffKeys.activity(userId ?? 'none'),
    queryFn: () => staffService.activity(userId!),
    enabled: userId !== null,
  });
}

/** Everything a crew or account change can move. */
function useRefreshStaff() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: staffKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['operator'] });
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
  };
}

/**
 * Provisions a login. The temporary password comes back exactly once — the
 * screen has to show it there and then, because nothing stores it.
 */
export function useCreateStaffAccount() {
  const refresh = useRefreshStaff();

  return useMutation({
    mutationFn: (input: CreateStaffInput) => staffService.createAccount(input),
    onSuccess: refresh,
  });
}

export function useResetStaffPassword() {
  const refresh = useRefreshStaff();

  return useMutation({
    mutationFn: (userId: UUID) => staffService.resetPassword(userId),
    onSuccess: refresh,
  });
}

export function useSetAccountStatus() {
  const refresh = useRefreshStaff();

  return useMutation({
    mutationFn: ({
      userId,
      status,
      reason,
    }: {
      userId: UUID;
      status: AccountStatus;
      reason?: string;
    }) => staffService.setAccountStatus(userId, status, reason),
    onSuccess: refresh,
  });
}

export function useCreateCrew() {
  const refresh = useRefreshStaff();

  return useMutation({
    mutationFn: (input: CreateCrewInput) => staffService.createCrew(input),
    onSuccess: refresh,
  });
}

export function useUpdateCrew() {
  const refresh = useRefreshStaff();

  return useMutation({
    mutationFn: ({
      kind,
      crewId,
      ...input
    }: {
      kind: CrewKind;
      crewId: UUID;
      name: string;
      phone?: string;
      licenseNumber?: string;
      licenseExpirationDate?: ISODate;
    }) => staffService.updateCrew(kind, crewId, input),
    onSuccess: refresh,
  });
}

/**
 * The crew member's own availability switch.
 *
 * Invalidates the same keys as the manager-facing mutation, so an operator with
 * the crew screen open sees the change without reloading.
 */
export function useSetMyAvailability() {
  const refresh = useRefreshStaff();

  return useMutation({
    mutationFn: ({ status, reason }: { status: AvailabilityStatus; reason?: string }) =>
      staffService.setMyAvailability(status, reason),
    onSuccess: refresh,
  });
}

export function useSetCrewAvailability() {
  const refresh = useRefreshStaff();

  return useMutation({
    mutationFn: ({
      kind,
      crewId,
      status,
      reason,
    }: {
      kind: CrewKind;
      crewId: UUID;
      status: AvailabilityStatus;
      reason?: string;
    }) => staffService.setAvailability(kind, crewId, status, reason),
    onSuccess: refresh,
  });
}
