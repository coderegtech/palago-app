import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { ArrowRight, UserCheck, Users } from 'lucide-react-native';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { TripStatus } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useOperatorTrips } from '@/hooks/use-operator';
import type { TripOverview } from '@/services/operator-service';
import { addDaysISO, formatDateShort, formatTime, todayISO } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

const tripStatusTone: Record<TripStatus, BadgeTone> = {
  [TripStatus.SCHEDULED]: 'neutral',
  [TripStatus.BOARDING]: 'warning',
  [TripStatus.DEPARTED]: 'info',
  [TripStatus.ON_TRIP]: 'info',
  [TripStatus.ARRIVED]: 'success',
  [TripStatus.COMPLETED]: 'success',
  [TripStatus.CANCELLED]: 'danger',
};

function TripRow({ trip }: { trip: TripOverview }) {
  const boardingProgress =
    trip.passengerCount > 0 ? Math.round((trip.boardedCount / trip.passengerCount) * 100) : 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${trip.tripNumber}, ${trip.originCode} to ${trip.destinationCode}, ${trip.passengerCount} passengers, ${trip.boardedCount} boarded`}
      onPress={() =>
        router.push({ pathname: '/(operator)/manifest', params: { tripId: trip.id } })
      }>
      <Card className="gap-3 active:bg-primary-soft">
        <View className="flex-row items-center justify-between">
          <Text variant="mono" className="text-[12px]">
            {trip.tripNumber}
          </Text>
          <Badge label={trip.status} tone={tripStatusTone[trip.status]} />
        </View>

        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <Text variant="bodyStrong">{formatTime(trip.departureTime)}</Text>
            <Text variant="caption" tone="muted">
              {trip.originCode}
            </Text>
          </View>
          <ArrowRight size={14} color={Colors.textMuted} />
          <View className="flex-1 items-end">
            <Text variant="bodyStrong">{formatTime(trip.arrivalTime)}</Text>
            <Text variant="caption" tone="muted">
              {trip.destinationCode}
            </Text>
          </View>
        </View>

        <View className="gap-1">
          <View className="flex-row items-center justify-between">
            <Text variant="caption" tone="muted">
              Boarding
            </Text>
            <Text variant="caption" className="font-semibold">
              {trip.boardedCount}/{trip.passengerCount}
            </Text>
          </View>
          <View className="h-1.5 overflow-hidden rounded-full bg-border">
            <View
              className="h-full rounded-full bg-success"
              style={{ width: `${boardingProgress}%` }}
            />
          </View>
        </View>

        <View className="flex-row items-center justify-between border-t border-border pt-3">
          <View className="gap-0.5">
            <Text variant="caption" tone="muted">
              {trip.busNumber} · {trip.seatsBooked}/{trip.capacity} seats
            </Text>
            <Text variant="caption" tone={trip.driverName ? 'muted' : 'danger'}>
              {trip.driverName ?? 'No driver assigned'}
              {trip.assistantName ? ` · ${trip.assistantName}` : ''}
            </Text>
          </View>
          <View className="items-end">
            <Text variant="bodyStrong" tone="primary">
              {formatMoney(trip.revenue)}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

export default function TravelDataScreen() {
  const [date, setDate] = useState<string | undefined>(todayISO());
  const trips = useOperatorTrips(date);

  const dateOptions = [
    { label: 'Today', value: todayISO() },
    { label: formatDateShort(addDaysISO(todayISO(), 1)), value: addDaysISO(todayISO(), 1) },
    { label: formatDateShort(addDaysISO(todayISO(), 2)), value: addDaysISO(todayISO(), 2) },
    { label: 'All', value: undefined },
  ];

  const totals = (trips.data ?? []).reduce(
    (acc, t) => ({
      passengers: acc.passengers + t.passengerCount,
      boarded: acc.boarded + t.boardedCount,
      revenue: acc.revenue + t.revenue,
    }),
    { passengers: 0, boarded: 0, revenue: 0 },
  );

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Travel data" subtitle="Trips, crew and boarding" />
      </View>

      <FlatList
        data={trips.data ?? []}
        keyExtractor={(trip) => trip.id}
        contentContainerClassName="px-4 pb-8 gap-3"
        refreshing={trips.isFetching}
        onRefresh={() => trips.refetch()}
        ListHeaderComponent={
          <View className="gap-3 pb-1">
            <View className="flex-row flex-wrap gap-2">
              {dateOptions.map((option) => (
                <Pressable
                  key={option.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: option.value === date }}
                  accessibilityLabel={option.label}
                  onPress={() => setDate(option.value)}
                  className={`min-h-11 justify-center rounded-full border px-4 ${
                    option.value === date ? 'border-primary bg-primary' : 'border-border bg-surface'
                  }`}>
                  <Text
                    variant="caption"
                    tone={option.value === date ? 'inverse' : 'default'}
                    className="font-semibold">
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {trips.data && trips.data.length > 0 ? (
              <Card className="flex-row justify-between">
                <View className="items-center">
                  <Text variant="bodyStrong">{trips.data.length}</Text>
                  <Text variant="caption" tone="muted">
                    trips
                  </Text>
                </View>
                <View className="items-center">
                  <View className="flex-row items-center gap-1">
                    <Users size={12} color={Colors.textMuted} />
                    <Text variant="bodyStrong">{totals.passengers}</Text>
                  </View>
                  <Text variant="caption" tone="muted">
                    passengers
                  </Text>
                </View>
                <View className="items-center">
                  <View className="flex-row items-center gap-1">
                    <UserCheck size={12} color={Colors.textMuted} />
                    <Text variant="bodyStrong">{totals.boarded}</Text>
                  </View>
                  <Text variant="caption" tone="muted">
                    boarded
                  </Text>
                </View>
                <View className="items-center">
                  <Text variant="bodyStrong" tone="primary">
                    {formatMoney(totals.revenue)}
                  </Text>
                  <Text variant="caption" tone="muted">
                    revenue
                  </Text>
                </View>
              </Card>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <TripRow trip={item} />}
        ListEmptyComponent={
          trips.isPending ? (
            <Loading label="Loading trips…" className="py-12" />
          ) : trips.isError ? (
            <ErrorState message="Could not load trips." onRetry={() => trips.refetch()} className="py-10" />
          ) : (
            <EmptyState
              title="No trips"
              message={
                date
                  ? 'Nothing scheduled for this date. Try another, or All.'
                  : 'No trips have been scheduled for this operator yet.'
              }
              className="py-12"
            />
          )
        }
      />
    </Screen>
  );
}
