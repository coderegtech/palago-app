import { FlatList, View } from 'react-native';
import { Bus, Ship } from 'lucide-react-native';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useBuses } from '@/hooks/use-operator';

export default function BusesScreen() {
  const buses = useBuses();

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Fleet" subtitle="Buses and RoRo coaches" showBack fallbackHref="/(operator)/dashboard" />
      </View>

      <FlatList
        data={buses.data ?? []}
        keyExtractor={(bus) => bus.id}
        contentContainerClassName="px-4 pb-8 gap-3"
        refreshing={buses.isFetching}
        onRefresh={() => buses.refetch()}
        renderItem={({ item }) => (
          <Card className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
              {item.busType === 'RORO' ? (
                <Ship size={18} color={Colors.primary} />
              ) : (
                <Bus size={18} color={Colors.primary} />
              )}
            </View>
            <View className="flex-1 gap-0.5">
              <Text variant="bodyStrong">{item.name ?? item.busNumber}</Text>
              <Text variant="caption" tone="muted">
                {item.busNumber} · {item.plateNumber} · {item.capacity} seats
              </Text>
            </View>
            <Badge label={item.status} tone={item.status === 'ACTIVE' ? 'success' : 'neutral'} />
          </Card>
        )}
        ListEmptyComponent={
          buses.isPending ? (
            <Loading label="Loading fleet…" className="py-12" />
          ) : buses.isError ? (
            <ErrorState message="Could not load your fleet." onRetry={() => buses.refetch()} className="py-10" />
          ) : (
            <EmptyState title="No buses yet" message="Your fleet will appear here." className="py-12" />
          )
        }
      />
    </Screen>
  );
}
