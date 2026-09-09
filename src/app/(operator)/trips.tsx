import { router } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';
import { ArrowRight } from 'lucide-react-native';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useOperatorTrips } from '@/hooks/use-operator';
import { formatDateShort, formatTime } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

/**
 * All departures for this operator, across dates.
 *
 * Travel data is the day-to-day operational view; this is the whole schedule.
 */
export default function OperatorTripsScreen() {
  const trips = useOperatorTrips();

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Trips" subtitle="Full schedule" showBack fallbackHref="/(operator)/dashboard" />
      </View>

      <FlatList
        data={trips.data ?? []}
        keyExtractor={(trip) => trip.id}
        contentContainerClassName="px-4 pb-8 gap-3"
        refreshing={trips.isFetching}
        onRefresh={() => trips.refetch()}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.tripNumber} manifest`}
            onPress={() => router.push({ pathname: '/(operator)/manifest', params: { tripId: item.id } })}>
            <Card className="gap-2 active:bg-primary-soft">
              <View className="flex-row items-center justify-between">
                <Text variant="mono" className="text-[12px]">{item.tripNumber}</Text>
                <Badge label={item.status} tone={item.status === 'CANCELLED' ? 'danger' : 'neutral'} />
              </View>
              <View className="flex-row items-center gap-2">
                <Text variant="bodyStrong">{item.originCode}</Text>
                <ArrowRight size={13} color={Colors.textMuted} />
                <Text variant="bodyStrong">{item.destinationCode}</Text>
                <Text variant="caption" tone="muted" className="flex-1 text-right">
                  {formatDateShort(item.departureDate)} · {formatTime(item.departureTime)}
                </Text>
              </View>
              <View className="flex-row items-center justify-between border-t border-border pt-2">
                <Text variant="caption" tone="muted">
                  {item.busNumber} · {item.passengerCount} pax · {formatMoney(item.fare)} fare
                </Text>
                <Text variant="caption" tone={item.driverName ? 'muted' : 'danger'}>
                  {item.driverName ?? 'No driver'}
                </Text>
              </View>
            </Card>
          </Pressable>
        )}
        ListEmptyComponent={
          trips.isPending ? (
            <Loading label="Loading schedule…" className="py-12" />
          ) : trips.isError ? (
            <ErrorState message="Could not load the schedule." onRetry={() => trips.refetch()} className="py-10" />
          ) : (
            <EmptyState title="No trips scheduled" message="Departures will appear here." className="py-12" />
          )
        }
      />
    </Screen>
  );
}
