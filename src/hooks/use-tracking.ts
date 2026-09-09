/**
 * Tracking hooks.
 *
 * Reads are TanStack Query; the live updates are Realtime subscriptions that
 * invalidate those queries rather than patching the cache by hand. That costs
 * one extra round trip per event and buys correctness: the payload of an
 * INSERT is one raw row, while the screen needs the joined view, and a
 * hand-patched cache silently diverges the first time the shapes differ.
 *
 * Every subscription is torn down on unmount — see docs/realtime.md. A leaked
 * channel is the usual reason an app gets slower the longer it is open.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { LOCATION_STALE_AFTER_MS } from '@/constants/config';
import { TripStatus } from '@/constants/enums';
import { supabase } from '@/lib/supabase';
import { trackingService } from '@/services/tracking-service';
import type { UUID } from '@/types/models';

export const trackingKeys = {
  live: (tripId: UUID | null) => ['tracking', 'live', tripId] as const,
  trail: (tripId: UUID | null) => ['tracking', 'trail', tripId] as const,
  assignments: () => ['tracking', 'assignments'] as const,
};

/** Trip statuses during which a bus can be somewhere worth watching. */
export const LIVE_TRIP_STATUSES: readonly TripStatus[] = [
  TripStatus.BOARDING,
  TripStatus.DEPARTED,
  TripStatus.ON_TRIP,
];

export function useLivePosition(tripId: UUID | null) {
  return useQuery({
    queryKey: trackingKeys.live(tripId),
    queryFn: () => trackingService.getLivePosition(tripId as UUID),
    enabled: Boolean(tripId),
    // Realtime drives the updates. A short stale time still covers the gap
    // between mount and the channel being ready.
    staleTime: 5_000,
  });
}

export function useTrail(tripId: UUID | null, enabled = true) {
  return useQuery({
    queryKey: trackingKeys.trail(tripId),
    queryFn: () => trackingService.getTrail(tripId as UUID),
    enabled: Boolean(tripId) && enabled,
    staleTime: 15_000,
  });
}

export function useMyAssignments() {
  return useQuery({
    queryKey: trackingKeys.assignments(),
    queryFn: () => trackingService.listMyAssignments(),
    staleTime: 30_000,
  });
}

/**
 * Subscribe to one trip's position and status.
 *
 * Returns the channel state so a screen can say "live" or "reconnecting"
 * honestly instead of leaving a stale marker looking current.
 *
 * On (re)subscribe both queries are invalidated: a reconnect means events were
 * missed, and assuming otherwise leaves the map frozen at the last fix before
 * the tunnel.
 */
export function useTripTrackingSubscription(tripId: UUID | null) {
  const queryClient = useQueryClient();
  // Stamped with the trip it describes, so switching trips reads as
  // "connecting" by derivation rather than by a synchronous setState in the
  // effect body — which cascades a render and is what the React Compiler's
  // lint rule objects to.
  const [channelState, setChannelState] = useState<{
    tripId: UUID | null;
    status: 'connecting' | 'live' | 'error';
  }>({ tripId: null, status: 'connecting' });

  const status = channelState.tripId === tripId ? channelState.status : 'connecting';

  useEffect(() => {
    if (!tripId) return;

    const channel = supabase
      .channel(`trip-tracking-${tripId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bus_locations',
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: trackingKeys.live(tripId) });
          queryClient.invalidateQueries({ queryKey: trackingKeys.trail(tripId) });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: trackingKeys.live(tripId) });
          queryClient.invalidateQueries({ queryKey: trackingKeys.assignments() });
        },
      )
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') {
          setChannelState({ tripId, status: 'live' });
          // Catch up on anything missed while the channel was down.
          queryClient.invalidateQueries({ queryKey: trackingKeys.live(tripId) });
          queryClient.invalidateQueries({ queryKey: trackingKeys.trail(tripId) });
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          setChannelState({ tripId, status: 'error' });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tripId, queryClient]);

  return status;
}

/**
 * Is a fix recent enough to present as the bus's current position?
 *
 * Recomputed on a timer, because staleness is a function of the clock and not
 * of any query: without the tick, a marker that went stale while the screen sat
 * open would keep claiming to be live.
 */
export function usePositionFreshness(recordedAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!recordedAt) return;
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [recordedAt]);

  if (!recordedAt) return { ageMs: null, isStale: false as boolean };

  const ageMs = Math.max(0, now - new Date(recordedAt).getTime());
  return { ageMs, isStale: ageMs > LOCATION_STALE_AFTER_MS };
}

/**
 * Everything a trip-status change invalidates.
 *
 * Kept in one place because the three mutations move the same things: the crew
 * board, the live view, the operator's day, and the passenger's booking status
 * (`start_trip` moves BOARDED bookings to ON_TRIP, `end_trip` to COMPLETED).
 * A screen showing yesterday's status after the driver ends a trip is the
 * failure this prevents.
 */
function useTripStatusInvalidation() {
  const queryClient = useQueryClient();

  return (tripId: UUID) => {
    queryClient.invalidateQueries({ queryKey: trackingKeys.assignments() });
    queryClient.invalidateQueries({ queryKey: trackingKeys.live(tripId) });
    queryClient.invalidateQueries({ queryKey: ['operator'] });
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
  };
}

export function useSetTripBoarding() {
  const invalidate = useTripStatusInvalidation();
  return useMutation({
    mutationFn: (tripId: UUID) => trackingService.setBoarding(tripId),
    onSuccess: (_result, tripId) => invalidate(tripId),
  });
}

export function useStartTrip() {
  const invalidate = useTripStatusInvalidation();
  return useMutation({
    mutationFn: (tripId: UUID) => trackingService.startTrip(tripId),
    onSuccess: (_result, tripId) => invalidate(tripId),
  });
}

export function useEndTrip() {
  const invalidate = useTripStatusInvalidation();
  return useMutation({
    mutationFn: (tripId: UUID) => trackingService.endTrip(tripId),
    onSuccess: (_result, tripId) => invalidate(tripId),
  });
}

/**
 * Publish fixes for a trip while `active` is true.
 *
 * `expo-location` is imported lazily so this module stays importable on web,
 * where the native module does not exist. The publisher is a no-op there rather
 * than a crash — a dispatcher looking at the operator console in a browser
 * should not meet a red screen.
 *
 * State is reported honestly: permission denied, services off, no fix yet, and
 * publish failures are all distinguishable, because "tracking is on" over a
 * silently dead GPS is the failure mode that matters here.
 */
export type PublisherState =
  | { kind: 'idle' }
  | { kind: 'unsupported' }
  | { kind: 'requesting' }
  | { kind: 'denied' }
  | { kind: 'services-off' }
  | { kind: 'waiting-for-fix' }
  | { kind: 'publishing'; lastPublishedAt: string; failures: number }
  | { kind: 'error'; message: string };

export function useLocationPublisher(tripId: UUID | null, active: boolean) {
  // Same stamping trick as the subscription above: the reported state belongs
  // to one (trip, active) pair, so turning sharing off reads as `idle` by
  // derivation instead of a synchronous setState inside the effect.
  const key = `${tripId ?? 'none'}:${active}`;
  const [published, setPublished] = useState<{ key: string; state: PublisherState }>({
    key: '',
    state: { kind: 'idle' },
  });
  const state: PublisherState = published.key === key ? published.state : { kind: 'idle' };
  // Kept in a ref so the effect does not re-run — and re-request permission —
  // every time a fix arrives.
  const failuresRef = useRef(0);

  useEffect(() => {
    if (!tripId || !active) return;

    const setState = (next: PublisherState) => setPublished({ key, state: next });
    let cancelled = false;
    let stop: (() => void) | undefined;

    (async () => {
      setState({ kind: 'requesting' });
      failuresRef.current = 0;

      let Location: typeof import('expo-location');
      try {
        Location = await import('expo-location');
      } catch {
        if (!cancelled) setState({ kind: 'unsupported' });
        return;
      }

      // Foreground only. Background location needs a separate Play Store
      // declaration, and publishing from a locked phone is a Phase 15 decision,
      // not something to switch on quietly here.
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setState({ kind: 'denied' });
        return;
      }

      if (!(await Location.hasServicesEnabledAsync())) {
        if (!cancelled) setState({ kind: 'services-off' });
        return;
      }

      if (!cancelled) setState({ kind: 'waiting-for-fix' });

      const { LOCATION_DISTANCE_INTERVAL_M, LOCATION_UPDATE_INTERVAL_MS } = await import(
        '@/constants/config'
      );

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: LOCATION_UPDATE_INTERVAL_MS,
          distanceInterval: LOCATION_DISTANCE_INTERVAL_M,
        },
        (fix) => {
          void (async () => {
            try {
              await trackingService.publishLocation({
                tripId,
                fix: {
                  latitude: fix.coords.latitude,
                  longitude: fix.coords.longitude,
                  // expo-location reports metres per second; the column is km/h.
                  speedKph:
                    fix.coords.speed !== null && fix.coords.speed >= 0
                      ? Number((fix.coords.speed * 3.6).toFixed(2))
                      : null,
                  heading:
                    fix.coords.heading !== null && fix.coords.heading >= 0
                      ? Number(fix.coords.heading.toFixed(2))
                      : null,
                  accuracyM:
                    fix.coords.accuracy !== null
                      ? Number(fix.coords.accuracy.toFixed(2))
                      : null,
                  recordedAt: new Date(fix.timestamp).toISOString(),
                },
              });
              if (cancelled) return;
              failuresRef.current = 0;
              setState({
                kind: 'publishing',
                lastPublishedAt: new Date().toISOString(),
                failures: 0,
              });
            } catch (error) {
              if (cancelled) return;
              failuresRef.current += 1;
              const message =
                error instanceof Error ? error.message : 'Could not send the position.';
              // One dropped ping on a mountain road is normal; a run of them is
              // not, and the driver needs to know before the trip ends.
              setState(
                failuresRef.current >= 3
                  ? { kind: 'error', message }
                  : {
                      kind: 'publishing',
                      lastPublishedAt: new Date().toISOString(),
                      failures: failuresRef.current,
                    },
              );
            }
          })();
        },
      );

      if (cancelled) {
        subscription.remove();
        return;
      }
      stop = () => subscription.remove();
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [tripId, active, key]);

  return state;
}
