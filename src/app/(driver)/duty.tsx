import { useMemo } from 'react';
import { ObserveInteractiveMarker } from 'expo-observe';
import { router } from 'expo-router';
import { ChevronRight, Clock, Users } from 'lucide-react-native';
import { FlatList, Pressable, View } from 'react-native';

import { SOSMonitor } from '@/components/common/sos-monitor';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { TripStatus } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useMyAssignments } from '@/hooks/use-tracking';
import { compareDriverTrips } from '@/utils/trip-order';
import type { DriverAssignment } from '@/services/tracking-service';
import { formatDateShort, formatTime, todayISO } from '@/utils/datetime';

/** Trip status shown as a word plus a tone — never colour alone. */
function statusTone(status: TripStatus): 'neutral' | 'warning' | 'info' | 'success' | 'danger' {
  switch (status) {
    case TripStatus.BOARDING:
      return 'warning';
    case TripStatus.DEPARTED:
    case TripStatus.ON_TRIP:
      return 'info';
    case TripStatus.ARRIVED:
    case TripStatus.COMPLETED:
      return 'success';
    case TripStatus.CANCELLED:
      return 'danger';
    default:
      return 'neutral';
  }
}

function AssignmentRow({ trip }: { trip: DriverAssignment }) {
  const isToday = trip.departureDate === todayISO();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${trip.tripNumber}, ${trip.originCode} to ${trip.destinationCode}, ${formatTime(trip.departureTime)}, ${trip.passengerCount} passengers`}
      onPress={() =>
        router.push({ pathname: '/(driver)/trip', params: { tripId: trip.tripId } })
      }>
      <Card className="gap-3">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 gap-0.5">
            <Text variant="bodyStrong">{trip.tripNumber}</Text>
            <Text variant="caption" tone="muted">
              {trip.originCode} → {trip.destinationCode} · {trip.busNumber}
            </Text>
          </View>
          <View className="items-end gap-1">
            <Badge label={trip.tripStatus} tone={statusTone(trip.tripStatus)} />
            {isToday ? <Badge label="TODAY" tone="info" /> : null}
          </View>
        </View>

        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-1.5">
            <Clock size={14} color={Colors.textMuted} />
            <Text variant="caption" tone="muted">
              {formatDateShort(trip.departureDate)} · {formatTime(trip.departureTime)}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <Users size={14} color={Colors.textMuted} />
            <Text variant="caption" tone="muted">
              {trip.boardedCount}/{trip.passengerCount} aboard
            </Text>
            <ChevronRight size={16} color={Colors.textMuted} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

export default function DutyScreen() {
  const assignments = useMyAssignments();
  // What needs doing first — the trip being driven, then boarding, then the
  // rest of the roster — rather than a calendar. See utils/trip-order.ts.
  const roster = useMemo(
    () =>
      [...(assignments.data ?? [])].sort((a, b) =>
        compareDriverTrips(
          { status: a.tripStatus, departureDate: a.departureDate, departureTime: a.departureTime },
          { status: b.tripStatus, departureDate: b.departureDate, departureTime: b.departureTime },
        ),
      ),
    [assignments.data],
  );

  return (
    <Screen padded={false}>
      {/* Crew land here on a cold start; TTI is when the roster is on screen. */}
      {!assignments.isPending && <ObserveInteractiveMarker />}
      <FlatList
        data={roster}
        keyExtractor={(item) => item.assignmentId}
        contentContainerClassName="px-4 pb-8 gap-3"
        showsVerticalScrollIndicator={false}
        refreshing={assignments.isFetching}
        onRefresh={() => assignments.refetch()}
        ListHeaderComponent={
          <View className="gap-3">
            <Header title="My trips" subtitle="Trips assigned to you" />
            {/* The crew are the nearest help there is — an alert on their coach
                shows here first, above the roster. */}
            <SOSMonitor emptyHint="An alert raised by a passenger on your trips appears here." />
          </View>
        }
        renderItem={({ item }) => <AssignmentRow trip={item} />}
        ListEmptyComponent={
          assignments.isPending ? (
            <Loading label="Loading your trips…" className="py-12" />
          ) : assignments.isError ? (
            <ErrorState
              message="Could not load your assignments."
              onRetry={() => assignments.refetch()}
            />
          ) : (
            <EmptyState
              title="No trips assigned"
              message="When your operator assigns you a trip it will appear here."
            />
          )
        }
      />
    </Screen>
  );
}
