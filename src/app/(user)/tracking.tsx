import { router, useLocalSearchParams } from 'expo-router';
import { Bus, ChevronRight, Clock, Gauge, Radio, TriangleAlert } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Map } from '@/components/ui/map';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { BookingStatus, TripStatus } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useBookings } from '@/hooks/use-trips';
import {
  useLivePosition,
  usePositionFreshness,
  useTrail,
  useTripTrackingSubscription,
} from '@/hooks/use-tracking';
import type { BookingSummary } from '@/services/booking-service';
import { formatDateShort, formatTime } from '@/utils/datetime';

/**
 * Bookings whose bus is worth looking for.
 *
 * The same statuses `can_track_trip` accepts server-side. A cancelled or
 * refunded booking is excluded here *and* refused by the database — this list
 * only decides what to offer, never what may be read.
 */
const TRACKABLE: readonly BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
  BookingStatus.BOARDED,
  BookingStatus.ON_TRIP,
];

function BookingPicker({ bookings }: { bookings: BookingSummary[] }) {
  return (
    <View className="gap-3">
      <Text variant="label" tone="muted">
        Choose a trip
      </Text>
      {bookings.map((booking) => (
        <Pressable
          key={booking.id}
          accessibilityRole="button"
          accessibilityLabel={`Track ${booking.tripNumber}, ${booking.originCode} to ${booking.destinationCode}`}
          onPress={() =>
            router.setParams({ tripId: booking.tripId })
          }>
          <Card className="flex-row items-center gap-3">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
              <Bus size={18} color={Colors.primary} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text variant="bodyStrong">
                {booking.originCode} → {booking.destinationCode}
              </Text>
              <Text variant="caption" tone="muted">
                {booking.tripNumber} · {formatDateShort(booking.departureDate)}{' '}
                {formatTime(booking.departureTime)}
              </Text>
            </View>
            <ChevronRight size={18} color={Colors.textMuted} />
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

export default function TrackingScreen() {
  const { tripId: tripIdParam } = useLocalSearchParams<{ tripId?: string }>();
  const bookings = useBookings();

  const trackable = useMemo(
    () => (bookings.data ?? []).filter((b) => TRACKABLE.includes(b.status)),
    [bookings.data],
  );

  // One trackable trip needs no picker; a passenger opening "Track trip" with a
  // single ticket wants the map, not a list of one.
  const tripId = tripIdParam ?? (trackable.length === 1 ? trackable[0].tripId : null);

  const live = useLivePosition(tripId);
  const channel = useTripTrackingSubscription(tripId);
  const trip = live.data;
  const trail = useTrail(tripId, Boolean(trip?.position));
  const freshness = usePositionFreshness(trip?.position?.recordedAt);

  const centre = (trip?.position?.coordinate ??
    trip?.origin.coordinate ?? [118.7353, 9.7392]) as [number, number];

  if (bookings.isPending) {
    return (
      <Screen>
        <Header title="Track trip" showBack fallbackHref="/(user)/home" />
        <Loading label="Finding your trips…" className="py-12" />
      </Screen>
    );
  }

  if (bookings.isError) {
    return (
      <Screen>
        <Header title="Track trip" showBack fallbackHref="/(user)/home" />
        <ErrorState message="Could not load your bookings." onRetry={() => bookings.refetch()} />
      </Screen>
    );
  }

  if (trackable.length === 0) {
    return (
      <Screen>
        <Header title="Track trip" showBack fallbackHref="/(user)/home" />
        <EmptyState
          title="No trips to track"
          message="Live tracking is available for a confirmed booking. Book a trip and it will appear here."
          actionLabel="Find a trip"
          onAction={() => router.push('/booking/search')}
        />
      </Screen>
    );
  }

  if (!tripId) {
    return (
      <Screen scroll>
        <Header title="Track trip" showBack fallbackHref="/(user)/home" />
        <BookingPicker bookings={trackable} />
      </Screen>
    );
  }

  if (live.isPending) {
    return (
      <Screen>
        <Header title="Track trip" showBack fallbackHref="/(user)/home" />
        <Loading label="Locating the bus…" className="py-12" />
      </Screen>
    );
  }

  if (live.isError || !trip) {
    return (
      <Screen>
        <Header title="Track trip" showBack fallbackHref="/(user)/home" />
        <ErrorState
          message="Could not load this trip. Tracking is only available for a trip you hold a booking on."
          onRetry={() => live.refetch()}
        />
      </Screen>
    );
  }

  const hasDeparted = Boolean(trip.actualDepartureAt);
  const hasArrived = Boolean(trip.actualArrivalAt);
  const isLive =
    trip.tripStatus === TripStatus.DEPARTED || trip.tripStatus === TripStatus.ON_TRIP;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerClassName="px-4 pb-8 gap-4" showsVerticalScrollIndicator={false}>
        <Header
          title={`${trip.origin.code} → ${trip.destination.code}`}
          subtitle={`${trip.tripNumber} · ${trip.busNumber}`}
          showBack
          fallbackHref="/(user)/home"
        />

        {/*
          The honest states, in order of how misleading their absence would be.
          A map with a motionless marker and no explanation is the single worst
          thing this screen can show.
        */}
        {hasArrived ? (
          <Alert
            tone="success"
            title="This trip has arrived"
            message={`The bus reached ${trip.destination.name} at ${new Date(
              trip.actualArrivalAt as string,
            ).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`}
          />
        ) : !hasDeparted ? (
          <Alert
            tone="info"
            title="The bus has not departed yet"
            message={`Scheduled to leave ${trip.origin.name} at ${formatTime(
              trip.departureTime,
            )}. The map will show the bus once the driver starts the trip.`}
          />
        ) : !trip.position ? (
          <Alert
            tone="warning"
            title="No position yet"
            message="The trip has started but the driver's phone has not sent a position. This usually means no signal on that stretch of road."
          />
        ) : freshness.isStale ? (
          <Alert
            tone="warning"
            title="Last known position"
            message={`This is where the bus was ${Math.round(
              (freshness.ageMs ?? 0) / 60000,
            )} minute(s) ago. Updates stopped — most likely a gap in mobile coverage.`}
          />
        ) : null}

        <Map
          center={centre}
          zoom={trip.position ? 13 : 10}
          className="h-72"
          followCenter={Boolean(trip.position) && !freshness.isStale}
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

        <Card className="gap-3">
          <View className="flex-row items-center justify-between">
            <Badge
              label={trip.tripStatus}
              tone={isLive ? 'info' : hasArrived ? 'success' : 'neutral'}
            />
            <View className="flex-row items-center gap-1.5">
              <Radio size={13} color={channel === 'live' ? Colors.success : Colors.textMuted} />
              <Text variant="caption" tone="muted">
                {channel === 'live' ? 'Live updates on' : 'Reconnecting…'}
              </Text>
            </View>
          </View>

          <View className="flex-row gap-4">
            <View className="flex-1 gap-0.5">
              <Text variant="caption" tone="muted">
                Scheduled departure
              </Text>
              <Text variant="bodyStrong">{formatTime(trip.departureTime)}</Text>
            </View>
            <View className="flex-1 gap-0.5">
              <Text variant="caption" tone="muted">
                Actual departure
              </Text>
              <Text variant="bodyStrong">
                {trip.actualDepartureAt
                  ? new Date(trip.actualDepartureAt).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : '—'}
              </Text>
            </View>
          </View>

          {trip.position ? (
            <View className="flex-row items-center gap-4">
              <View className="flex-row items-center gap-1.5">
                <Gauge size={14} color={Colors.textMuted} />
                <Text variant="caption" tone="muted">
                  {trip.position.speedKph !== null
                    ? `${Math.round(trip.position.speedKph)} km/h`
                    : 'Speed unknown'}
                </Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <Clock size={14} color={Colors.textMuted} />
                <Text variant="caption" tone={freshness.isStale ? 'danger' : 'muted'}>
                  Updated {Math.round((freshness.ageMs ?? 0) / 1000)}s ago
                </Text>
              </View>
            </View>
          ) : null}
        </Card>

        {/*
          No estimated arrival. A straight-line distance over an average speed
          would be wrong on the Puerto Princesa–El Nido road, and a passenger
          who misses a connection because PalaGo guessed is worse off than one
          who was told nothing. The scheduled arrival is real and is shown.
        */}
        <Card className="gap-2">
          <Text variant="label" tone="muted">
            Arrival
          </Text>
          <Text variant="bodyStrong">Scheduled {formatTime(trip.arrivalTime)}</Text>
          <View className="flex-row items-start gap-2">
            <TriangleAlert size={14} color={Colors.textMuted} />
            <Text variant="caption" tone="muted" className="flex-1">
              PalaGo does not estimate arrival time. Road conditions between terminals vary too much
              for a guess to be worth acting on — this is the operator&apos;s scheduled time.
            </Text>
          </View>
        </Card>

        {trackable.length > 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Track a different trip"
            className="min-h-11 items-center justify-center"
            onPress={() => router.setParams({ tripId: undefined })}>
            <Text variant="bodyStrong" tone="primary">
              Track a different trip
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
