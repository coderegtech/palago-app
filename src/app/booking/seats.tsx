import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { SeatMap } from '@/components/booking/seat-map';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { useTrip, useTripSeats } from '@/hooks/use-trips';
import { useBookingStore } from '@/stores/booking-store';
import type { TripSeatView } from '@/services/trip-service';
import { formatMoney } from '@/utils/money';

export default function SeatsScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const trip = useTrip(tripId ?? null);
  const seats = useTripSeats(tripId ?? null);

  const passengerCount = useBookingStore((state) => state.passengerCount);
  const selectedSeats = useBookingStore((state) => state.selectedSeats);
  const toggleSeat = useBookingStore((state) => state.toggleSeat);
  const storeTripId = useBookingStore((state) => state.tripId);
  const selectTrip = useBookingStore((state) => state.selectTrip);

  // Adopt the trip from the URL when the draft does not already hold it — a
  // deep link or a reload starts with an empty store, and without this the
  // funnel would carry no trip id into the passengers step.
  useEffect(() => {
    if (tripId && storeTripId !== tripId) selectTrip(tripId, passengerCount);
  }, [tripId, storeTripId, selectTrip, passengerCount]);

  const selectedIds = selectedSeats.map((s) => s.seatId);
  const remaining = passengerCount - selectedSeats.length;
  const complete = remaining === 0;

  function onToggle(seat: TripSeatView) {
    toggleSeat({ seatId: seat.seatId, seatNumber: seat.seatNumber });
  }

  if (seats.isPending || trip.isPending) {
    return (
      <Screen>
        <Header title="Select seats" showBack />
        <Loading label="Loading seat map…" />
      </Screen>
    );
  }

  if (seats.isError || trip.isError || !trip.data) {
    return (
      <Screen>
        <Header title="Select seats" showBack />
        <ErrorState
          message="Could not load the seat map."
          onRetry={() => {
            seats.refetch();
            trip.refetch();
          }}
        />
      </Screen>
    );
  }

  const fare = trip.data.fare;
  const subtotal = fare * selectedSeats.length;

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header
          title="Select seats"
          subtitle={`${trip.data.originCode} → ${trip.data.destinationCode} · ${trip.data.busNumber}`}
          showBack
        />
      </View>

      <View className="flex-1 px-4">
        <Screen padded={false} scroll className="bg-transparent" edges={[]}>
          <Alert
            tone={complete ? 'success' : 'info'}
            title={
              complete
                ? `${passengerCount} ${passengerCount === 1 ? 'seat' : 'seats'} selected`
                : `Choose ${remaining} more ${remaining === 1 ? 'seat' : 'seats'}`
            }
            message={
              complete
                ? 'Tap a seat to change your choice.'
                : `Tap ${passengerCount} ${passengerCount === 1 ? 'seat' : 'seats'} on the map below.`
            }
            className="mb-4"
          />

          <SeatMap seats={seats.data} selectedSeatIds={selectedIds} onToggleSeat={onToggle} />

          <Card className="mt-4 gap-2">
            <View className="flex-row items-start justify-between gap-3">
              <Text variant="body" tone="muted">
                Selected
              </Text>
              <Text variant="bodyStrong" className="flex-1 text-right">
                {selectedSeats.length > 0
                  ? selectedSeats
                      .map((s) => s.seatNumber)
                      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                      .join(', ')
                  : 'None yet'}
              </Text>
            </View>

            <View className="flex-row items-center justify-between">
              <Text variant="body" tone="muted">
                {formatMoney(fare)} × {selectedSeats.length}
              </Text>
              <Text variant="bodyStrong">{formatMoney(subtotal)}</Text>
            </View>

            <Divider className="my-1" />

            <View className="flex-row items-end justify-between">
              <Text variant="bodyStrong">Subtotal</Text>
              <Text variant="title" tone="primary">
                {formatMoney(subtotal)}
              </Text>
            </View>

            <Text variant="caption" tone="muted">
              Discounts are applied by the server when the booking is created.
            </Text>
          </Card>
        </Screen>
      </View>

      <View className="border-t border-border bg-surface px-4 pb-6 pt-3">
        <Button
          label={complete ? 'Continue' : `Choose ${remaining} more`}
          disabled={!complete}
          // The trip id travels in the URL as well as the store, so the next
          // screen works even if the draft was lost to a reload.
          onPress={() => router.push({ pathname: '/booking/passengers', params: { tripId } })}
        />
      </View>
    </Screen>
  );
}
