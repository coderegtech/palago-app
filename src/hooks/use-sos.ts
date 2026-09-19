/**
 * Emergency assistance hooks.
 *
 * An open alert is the one piece of server state in PalaGo where being stale is
 * dangerous rather than untidy, so the operator's list is both subscribed to
 * over Realtime and polled as a fallback: a dropped websocket must not be the
 * reason nobody saw an alert.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { sosService } from '@/services/sos-service';
import { supabase } from '@/lib/supabase';
import type { UUID } from '@/types/models';

export const sosKeys = {
  all: ['sos'] as const,
  mine: () => ['sos', 'mine'] as const,
  open: () => ['sos', 'open'] as const,
  detail: (id: UUID) => ['sos', 'detail', id] as const,
};

/** The signed-in passenger's own alerts. */
export function useUserSOSHistory() {
  return useQuery({
    queryKey: sosKeys.mine(),
    queryFn: () => sosService.listMine(),
    staleTime: 15_000,
  });
}

export function useSOSIncident(id: UUID | undefined) {
  return useQuery({
    queryKey: sosKeys.detail(id ?? ('' as UUID)),
    queryFn: () => sosService.getById(id as UUID),
    enabled: Boolean(id),
  });
}

/**
 * Alerts still needing attention. Scoped by RLS to the caller's own trips, so
 * an operator sees theirs and a passenger sees only their own.
 *
 * Polled every 15s in addition to the Realtime subscription below. Belt and
 * braces on purpose — see the note at the top of this file.
 */
export function useActiveSOSIncidents() {
  return useQuery({
    queryKey: sosKeys.open(),
    queryFn: () => sosService.listOpen(),
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}

/**
 * Live updates for the open-alert list.
 *
 * Invalidates on (re)subscribe as well as on each event: a reconnect means
 * events were missed, and an emergency console that quietly missed one is
 * worse than one that refetches too often.
 */
export function useSOSSubscription(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    // A name per subscriber. supabase-js hands back the SAME channel for a
    // repeated name, so two screens subscribing at once (the SOS screen over
    // home, the dashboard over another tab) shared one — and the first to
    // unmount removed it, silently ending the other's live updates.
    const channel = supabase
      .channel(`sos-incidents-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sos_incidents' },
        () => {
          queryClient.invalidateQueries({ queryKey: sosKeys.all });
        },
      )
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') {
          queryClient.invalidateQueries({ queryKey: sosKeys.all });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}

export function useTriggerSOS() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: sosService.trigger,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sosKeys.all });
    },
  });
}

export function useAcknowledgeSOS() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: UUID) => sosService.acknowledge(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sosKeys.all });
    },
  });
}

export function useRespondSOS() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: UUID) => sosService.respond(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sosKeys.all });
    },
  });
}

export function useResolveSOS() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sosId, notes }: { sosId: UUID; notes?: string | null }) =>
      sosService.resolve(sosId, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sosKeys.all });
    },
  });
}

export function useCancelSOS() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: UUID) => sosService.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sosKeys.all });
    },
  });
}
