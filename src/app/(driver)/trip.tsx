import { useLocalSearchParams } from 'expo-router';
import {
  CircleCheck,
  CircleDot,
  MapPin,
  Navigation,
  SatelliteDish,
  TriangleAlert,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Map } from '@/components/ui/map';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { LOCATION_UPDATE_INTERVAL_MS } from '@/constants/config';
import { TripStatus, UserRole } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import {
  useEndTrip,
  useLivePosition,
  useLocationPublisher,
  usePositionFreshness,
  useSetTripBoarding,
  useStartTrip,
  useTrail,
  useTripTrackingSubscription,
  type PublisherState,
} from '@/hooks/use-tracking';
import { AppError } from '@/lib/errors';
import { formatDateShort, formatTime } from '@/utils/datetime';

/**
 * What the driver is told about GPS, per state.
 *
 * Every failure mode gets its own line. "Tracking on" displayed over a denied
 * permission or a switched-off GPS is the failure that actually strands
 * passengers watching a marker that will never move.
 */
function publisherMessage(state: PublisherState): {
  tone: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  message: string;
} {
  switch (state.kind) {
    case 'idle':
      return {
        tone: 'info',
        title: 'Sharing is off',
        message: 'Start the trip to share the bus position with passengers.',
      };
    case 'unsupported':
      return {
        tone: 'warning',
        title: 'Location not available on this device',
        message:
          'Position sharing needs the PalaGo app on a phone. Passengers will see the schedule but no live position.',
      };
    case 'requesting':
      return {
        tone: 'info',
        title: 'Asking for location permission',
        message: 'Allow location so passengers can see where the bus is.',
      };
    case 'denied':
      return {
        tone: 'danger',
        title: 'Location permission denied',
        message:
          'Passengers cannot see the bus. Grant PalaGo location access in your phone settings, then start the trip again.',
      };
    case 'services-off':
      return {
        tone: 'danger',
        title: 'Location services are switched off',
        message: 'Turn on GPS in your phone settings. Nothing is being shared right now.',
      };
    case 'waiting-for-fix':
      return {
        tone: 'info',
        title: 'Waiting for a GPS fix',
        message: 'This can take a minute under cover. Nothing has been shared yet.',
      };
    case 'publishing':
      return state.failures > 0
        ? {
            tone: 'warning',
            title: 'Patchy connection',
            message: `Sharing the position, but ${state.failures} update(s) did not get through. It will catch up when signal returns.`,
          }
        : {
            tone: 'success',
            title: 'Sharing the bus position',
            message: `Passengers on this trip can see where the bus is, updated about every ${Math.round(
              LOCATION_UPDATE_INTERVAL_MS / 1000,
            )} seconds.`,
          };
    case 'error':
      return {
        tone: 'danger',
        title: 'Position updates are failing',
        message: `${state.message} Passengers are seeing the last position that got through.`,
      };
  }
}

export default function DriverTripScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const { role } = useAuth();
  const live = useLivePosition(tripId ?? null);
  const channel = useTripTrackingSubscription(tripId ?? null);
  const [publishing, setPublishing] = useState(false);
  /*
    Starting and ending a trip are consequential and irreversible-ish: starting
    stamps a departure time the operator will judge the driver on, and ending
    cuts every passenger off from the live position. A phone in a pocket on a
    bumpy road should not be able to do either with one stray tap, so both are
    confirmed. (An accidental start is exactly what happened while verifying
    this screen, via a synthetic tap.)
  */
  const [confirming, setConfirming] = useState<'start' | 'end' | null>(null);

  const trip = live.data;
  const isLive =
    trip?.tripStatus === TripStatus.DEPARTED || trip?.tripStatus === TripStatus.ON_TRIP;
  const trail = useTrail(tripId ?? null, Boolean(trip?.position));

  // Only a driver publishes. An assistant sees the same trip and can scan
  // tickets, but two phones on one bus posting positions is a jittering marker.
  const publisher = useLocationPublisher(
    role === UserRole.DRIVER ? (tripId ?? null) : null,
    publishing && isLive,
  );
  const freshness = usePositionFreshness(trip?.position?.recordedAt);

  const setBoarding = useSetTripBoarding();
  const startTrip = useStartTrip();
  const endTrip = useEndTrip();

  const mutationError = [setBoarding.error, startTrip.error, endTrip.error].find(Boolean);

  const centre = useMemo(
    () => trip?.position?.coordinate ?? trip?.origin.coordinate ?? [118.7353, 9.7392],
    [trip],
  ) as [number, number];

  if (!tripId) {
    return (
      <Screen>
        <Header title="Trip" showBack fallbackHref="/(driver)/duty" />
        <ErrorState message="No trip was selected. Go back and pick a trip from your list." />
      </Screen>
    );
  }

  if (live.isPending) {
    return (
      <Screen>
        <Header title="Trip" showBack fallbackHref="/(driver)/duty" />
        <Loading label="Loading the trip…" className="py-12" />
      </Screen>
    );
  }

  if (live.isError || !trip) {
    return (
      <Screen>
        <Header title="Trip" showBack fallbackHref="/(driver)/duty" />
        <ErrorState
          message="Could not load this trip. It may not be assigned to you."
          onRetry={() => live.refetch()}
        />
      </Screen>
    );
  }

  const gps = publisherMessage(publisher);
  const canBoard = trip.tripStatus === TripStatus.SCHEDULED;
  const canStart =
    trip.tripStatus === TripStatus.SCHEDULED || trip.tripStatus === TripStatus.BOARDING;
  const canEnd = isLive;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerClassName="px-4 pb-8 gap-4" showsVerticalScrollIndicator={false}>
        <Header
          title={trip.tripNumber}
          subtitle={`${trip.origin.code} → ${trip.destination.code} · ${trip.busNumber}`}
          showBack
          fallbackHref="/(driver)/duty"
        />

        {mutationError ? (
          <Alert
            tone="danger"
            title="That did not work"
            message={
              mutationError instanceof AppError
                ? mutationError.message
                : 'Please try again in a moment.'
            }
          />
        ) : null}

        <Card className="gap-3">
          <View className="flex-row items-center justify-between">
            <Badge
              label={trip.tripStatus}
              tone={isLive ? 'info' : trip.tripStatus === TripStatus.ARRIVED ? 'success' : 'neutral'}
            />
            <Text variant="caption" tone="muted">
              {formatDateShort(trip.departureDate)} · {formatTime(trip.departureTime)} →{' '}
              {formatTime(trip.arrivalTime)}
            </Text>
          </View>

          {/* Scheduled against actual, side by side, because that comparison is
              the whole point of recording the actual time. */}
          <View className="flex-row gap-4">
            <View className="flex-1 gap-0.5">
              <Text variant="caption" tone="muted">
                Left terminal
              </Text>
              <Text variant="bodyStrong">
                {trip.actualDepartureAt
                  ? new Date(trip.actualDepartureAt).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : 'Not yet'}
              </Text>
            </View>
            <View className="flex-1 gap-0.5">
              <Text variant="caption" tone="muted">
                Arrived
              </Text>
              <Text variant="bodyStrong">
                {trip.actualArrivalAt
                  ? new Date(trip.actualArrivalAt).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : 'Not yet'}
              </Text>
            </View>
          </View>
        </Card>

        <Alert tone={gps.tone} title={gps.title} message={gps.message} />

        <Map
          center={centre}
          zoom={trip.position ? 14 : 11}
          className="h-64"
          followCenter={Boolean(trip.position)}
          markers={[
            { id: 'origin', coordinate: trip.origin.coordinate },
            { id: 'destination', coordinate: trip.destination.coordinate },
            ...(trip.position ? [{ id: 'bus', coordinate: trip.position.coordinate }] : []),
          ]}
          polyline={
            (trail.data ?? []).length > 1
              ? (trail.data ?? []).map((point) => point.coordinate)
              : undefined
          }
        />

        <Card className="gap-2">
          <View className="flex-row items-center gap-2">
            <SatelliteDish size={16} color={Colors.textMuted} />
            <Text variant="label" tone="muted">
              Last position sent
            </Text>
          </View>
          {trip.position ? (
            <>
              <Text variant="bodyStrong">
                {trip.position.coordinate[1].toFixed(5)}, {trip.position.coordinate[0].toFixed(5)}
              </Text>
              <Text variant="caption" tone={freshness.isStale ? 'danger' : 'muted'}>
                {freshness.ageMs === null
                  ? ''
                  : freshness.isStale
                    ? `Stale — ${Math.round(freshness.ageMs / 1000)}s ago`
                    : `${Math.round(freshness.ageMs / 1000)}s ago`}
                {trip.position.accuracyM !== null
                  ? ` · ±${Math.round(trip.position.accuracyM)}m`
                  : ''}
              </Text>
            </>
          ) : (
            <Text variant="caption" tone="muted">
              Nothing sent yet for this trip.
            </Text>
          )}
          <Text variant="caption" tone="muted" className="text-[10px]">
            Live channel: {channel === 'live' ? 'connected' : channel}
          </Text>
        </Card>

        {role !== UserRole.DRIVER ? (
          <Alert
            tone="info"
            title="Assistants do not share position"
            message="Only the assigned driver's phone publishes the bus position, so the marker cannot jump between two devices."
          />
        ) : null}

        <View className="gap-3">
          {canBoard ? (
            <Button
              label="Open boarding"
              variant="outline"
              loading={setBoarding.isPending}
              onPress={() => setBoarding.mutate(trip.tripId)}
            />
          ) : null}

          {canStart ? (
            <Button
              label="Start trip and share position"
              loading={startTrip.isPending}
              onPress={() => setConfirming('start')}
            />
          ) : null}

          {canEnd ? (
            <>
              <Button
                label={publishing ? 'Pause position sharing' : 'Resume position sharing'}
                variant="outline"
                onPress={() => setPublishing((current) => !current)}
              />
              <Button
                label="End trip"
                variant="danger"
                loading={endTrip.isPending}
                onPress={() => setConfirming('end')}
              />
            </>
          ) : null}

          {trip.tripStatus === TripStatus.ARRIVED ||
          trip.tripStatus === TripStatus.COMPLETED ? (
            <Card className="flex-row items-center gap-3 border-success/40 bg-success-soft">
              <CircleCheck size={20} color={Colors.success} />
              <Text variant="bodyStrong" className="flex-1">
                Trip finished. Position sharing has stopped.
              </Text>
            </Card>
          ) : null}

          {trip.tripStatus === TripStatus.CANCELLED ? (
            <Card className="flex-row items-center gap-3 border-danger/40 bg-danger-soft">
              <TriangleAlert size={20} color={Colors.danger} />
              <Text variant="bodyStrong" className="flex-1">
                This trip was cancelled.
              </Text>
            </Card>
          ) : null}
        </View>

        <View className="flex-row items-start gap-2 px-1">
          <MapPin size={14} color={Colors.textMuted} />
          <Text variant="caption" tone="muted" className="flex-1">
            Position sharing runs while this screen is open. It stops if you close the app — PalaGo
            does not track you in the background.
          </Text>
        </View>

        <View className="flex-row items-start gap-2 px-1">
          <CircleDot size={14} color={Colors.textMuted} />
          <Text variant="caption" tone="muted" className="flex-1">
            Only passengers holding a booking on this trip, and your operator, can see the position.
          </Text>
        </View>

        <View className="flex-row items-start gap-2 px-1">
          <Navigation size={14} color={Colors.textMuted} />
          <Text variant="caption" tone="muted" className="flex-1">
            Drive first. Do not use this screen while the bus is moving.
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming === 'end' ? 'End this trip?' : 'Start this trip?'}
        dismissOnBackdropPress={false}>
        <Text variant="body" tone="muted">
          {confirming === 'end'
            ? 'This records the arrival time and stops sharing the bus position. Passengers will no longer see where the bus is, and it cannot be restarted.'
            : `This records ${trip.tripNumber} as departing now, which is the time your operator's on-time figures use. Passengers will start seeing the bus position.`}
        </Text>
        <Button
          label={confirming === 'end' ? 'Yes, end the trip' : 'Yes, start the trip'}
          variant={confirming === 'end' ? 'danger' : 'primary'}
          className="mt-4"
          loading={startTrip.isPending || endTrip.isPending}
          onPress={() => {
            if (confirming === 'end') {
              endTrip.mutate(trip.tripId, { onSuccess: () => setPublishing(false) });
            } else {
              startTrip.mutate(trip.tripId, { onSuccess: () => setPublishing(true) });
            }
            setConfirming(null);
          }}
        />
        <Button
          label="Cancel"
          variant="outline"
          className="mt-2"
          onPress={() => setConfirming(null)}
        />
      </Modal>
    </Screen>
  );
}
