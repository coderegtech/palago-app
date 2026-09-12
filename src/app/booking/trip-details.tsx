import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { ArrowRight, Bus, Clock, MapPin, Users } from 'lucide-react-native';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useTrip } from '@/hooks/use-trips';
import { useBookingStore } from '@/stores/booking-store';
import { formatDate, formatDuration, formatTime } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View className="flex-row items-center gap-3">
      {icon}
      <Text variant="body" tone="muted" className="flex-1">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

export default function TripDetailsScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const trip = useTrip(tripId ?? null);
  const passengerCount = useBookingStore((state) => state.passengerCount);

  if (trip.isPending) {
    return (
      <Screen>
        <Header title="Trip details" showBack />
        <Loading label="Loading trip…" />
      </Screen>
    );
  }

  if (trip.isError || !trip.data) {
    return (
      <Screen>
        <Header title="Trip details" showBack />
        <ErrorState
          message="Could not load this trip. It may no longer be available."
          onRetry={() => trip.refetch()}
        />
      </Screen>
    );
  }

  const t = trip.data;
  const enoughSeats = t.availableSeats >= passengerCount;

  return (
    <Screen scroll>
      <Header title="Trip details" showBack />

      <Card className="mt-2 gap-4">
        <View className="flex-row items-center justify-between">
          <Badge label={t.operatorName} tone="primary" />
          <Badge label={t.busType === 'RORO' ? 'RoRo Bus' : 'Bus'} tone="neutral" />
        </View>

        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text variant="display">{formatTime(t.departureTime)}</Text>
            <Text variant="bodyStrong">{t.originCode}</Text>
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {t.originName}
            </Text>
          </View>

          <View className="items-center gap-1 px-2">
            <ArrowRight size={20} color={Colors.primary} />
            <Text variant="caption" tone="muted">
              {formatDuration(t.durationMinutes)}
            </Text>
          </View>

          <View className="flex-1 items-end">
            <Text variant="display">{formatTime(t.arrivalTime)}</Text>
            <Text variant="bodyStrong">{t.destinationCode}</Text>
            <Text variant="caption" tone="muted" numberOfLines={2} className="text-right">
              {t.destinationName}
            </Text>
          </View>
        </View>

        <Divider />

        <View className="gap-3">
          <DetailRow
            icon={<MapPin size={16} color={Colors.textMuted} />}
            label="Travel date"
            value={formatDate(t.departureDate)}
          />
          <DetailRow
            icon={<Bus size={16} color={Colors.textMuted} />}
            label="Bus"
            value={`${t.busNumber} · ${t.capacity} seats`}
          />
          <DetailRow
            icon={<Clock size={16} color={Colors.textMuted} />}
            label="Trip number"
            value={t.tripNumber}
          />
          <DetailRow
            icon={<Users size={16} color={Colors.textMuted} />}
            label="Seats available"
            value={String(t.availableSeats)}
          />
        </View>
      </Card>

      <Card className="mt-3 gap-2">
        <View className="flex-row items-center justify-between">
          <Text variant="body" tone="muted">
            Fare per passenger
          </Text>
          <Text variant="bodyStrong">{formatMoney(t.fare)}</Text>
        </View>
        <View className="flex-row items-center justify-between">
          <Text variant="body" tone="muted">
            Passengers
          </Text>
          <Text variant="bodyStrong">{passengerCount}</Text>
        </View>
        <Divider className="my-1" />
        <View className="flex-row items-end justify-between">
          <Text variant="bodyStrong">Estimated total</Text>
          <Text variant="title" tone="primary">
            {formatMoney(t.fare * passengerCount)}
          </Text>
        </View>
        <Text variant="caption" tone="muted">
          Confirmed by the server when you reserve.
        </Text>
      </Card>

      {!enoughSeats ? (
        <Text variant="caption" tone="danger" className="mt-4 text-center">
          Only {t.availableSeats} seats left — not enough for {passengerCount} passengers.
        </Text>
      ) : null}

      <Button
        label="Enter passenger details"
        className="mt-6"
        disabled={!enoughSeats}
        onPress={() =>
          router.push({ pathname: '/booking/passengers', params: { tripId: t.id } })
        }
      />
    </Screen>
  );
}
