import { View } from 'react-native';
import { ArrowRight, Clock } from 'lucide-react-native';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import type { TripSearchResult } from '@/services/trip-service';
import { formatMoney } from '@/utils/money';
import { formatDuration, formatTime } from '@/utils/datetime';

export interface TripCardProps {
  trip: TripSearchResult;
  passengers: number;
  onPress: (trip: TripSearchResult) => void;
}

/**
 * One search result.
 *
 * The fare shown is per passenger, labelled as such — quoting a party total on
 * a list row and a per-seat price on the next screen is how people end up
 * feeling misled.
 */
export function TripCard({ trip, passengers, onPress }: TripCardProps) {
  const seatsLeft = trip.availableSeats;
  const scarce = seatsLeft <= 5;

  return (
    <Card
      accessibilityRole="button"
      accessibilityLabel={`${trip.operatorName} ${formatTime(trip.departureTime)} to ${
        trip.destinationName
      }, ${formatMoney(trip.fare)} per passenger, ${seatsLeft} seats left`}
      onPress={() => onPress(trip)}
      className="gap-3 active:bg-primary-soft">
      <View className="flex-row items-center justify-between">
        <Badge label={trip.operatorName} tone="primary" />
        <Badge
          label={trip.busType === 'RORO' ? 'RoRo' : 'Bus'}
          tone="neutral"
        />
      </View>

      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text variant="subtitle">{formatTime(trip.departureTime)}</Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {trip.originCode}
          </Text>
        </View>

        <View className="items-center gap-1">
          <ArrowRight size={16} color={Colors.textMuted} />
          <View className="flex-row items-center gap-1">
            <Clock size={10} color={Colors.textMuted} />
            <Text variant="caption" tone="muted">
              {formatDuration(trip.durationMinutes)}
            </Text>
          </View>
        </View>

        <View className="flex-1 items-end">
          <Text variant="subtitle">{formatTime(trip.arrivalTime)}</Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {trip.destinationCode}
          </Text>
        </View>
      </View>

      <View className="flex-row items-end justify-between border-t border-border pt-3">
        <View>
          <Text variant="subtitle" tone="primary">
            {formatMoney(trip.fare)}
          </Text>
          <Text variant="caption" tone="muted">
            per passenger
          </Text>
        </View>

        <View className="items-end gap-1">
          <Text variant="caption" tone={scarce ? 'danger' : 'muted'}>
            {seatsLeft} {seatsLeft === 1 ? 'seat' : 'seats'} left
          </Text>
          <Text variant="caption" tone="muted">
            {formatMoney(trip.fare * passengers)} for {passengers}
          </Text>
        </View>
      </View>
    </Card>
  );
}
