import { useLocalSearchParams } from 'expo-router';
import { FlatList, View } from 'react-native';
import { Phone, UserCheck, UserX } from 'lucide-react-native';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useManifest, useOperatorTrip } from '@/hooks/use-operator';
import type { ManifestEntry } from '@/services/operator-service';
import { formatDate, formatTime } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

/** Boarding state, as the crew needs to read it at the door. */
function boardingBadge(entry: ManifestEntry): { label: string; tone: BadgeTone } {
  if (entry.boardedAt) return { label: 'Boarded', tone: 'success' };
  if (entry.checkedInAt) return { label: 'Checked in', tone: 'info' };
  if (entry.paymentStatus !== 'PAID') return { label: 'Unpaid', tone: 'danger' };
  return { label: 'Expected', tone: 'neutral' };
}

function PassengerRow({ entry }: { entry: ManifestEntry }) {
  const badge = boardingBadge(entry);
  const paid = entry.paymentStatus === 'PAID';

  return (
    <Card className="gap-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text variant="bodyStrong">{entry.passengerName}</Text>
          <Text variant="caption" tone="muted">
            {entry.passengerType}
          </Text>
        </View>
        <Badge label={`Seat ${entry.seatNumber}`} tone="primary" />
      </View>

      <Divider />

      <View className="flex-row items-center justify-between">
        <Text variant="mono" className="text-[11px]">
          {entry.bookingReference}
        </Text>
        <View className="flex-row items-center gap-2">
          {/* Payment shown explicitly: boarding an unpaid passenger is the
              mistake this screen exists to prevent. */}
          <Badge
            label={paid ? 'PAID' : entry.paymentStatus}
            tone={paid ? 'success' : 'danger'}
          />
          <Badge label={badge.label} tone={badge.tone} />
        </View>
      </View>

      {entry.phone ? (
        <View className="flex-row items-center gap-1.5">
          <Phone size={11} color={Colors.textMuted} />
          <Text variant="caption" tone="muted">
            {entry.phone}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

export default function ManifestScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const trip = useOperatorTrip(tripId ?? null);
  const manifest = useManifest(tripId ?? null);

  const boarded = (manifest.data ?? []).filter((e) => e.boardedAt).length;
  const unpaid = (manifest.data ?? []).filter((e) => e.paymentStatus !== 'PAID').length;

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header
          title="Passenger manifest"
          subtitle={trip.data ? `${trip.data.tripNumber} · ${trip.data.busNumber}` : undefined}
          showBack
          fallbackHref="/(operator)/travel-data"
        />
      </View>

      <FlatList
        data={manifest.data ?? []}
        keyExtractor={(entry) => entry.id}
        contentContainerClassName="px-4 pb-8 gap-3"
        refreshing={manifest.isFetching}
        onRefresh={() => manifest.refetch()}
        ListHeaderComponent={
          <View className="gap-3 pb-1">
            {trip.data ? (
              <Card className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Text variant="subtitle">
                    {trip.data.originCode} → {trip.data.destinationCode}
                  </Text>
                  <Badge label={trip.data.status} tone="neutral" />
                </View>
                <Text variant="caption" tone="muted">
                  {formatDate(trip.data.departureDate)} · {formatTime(trip.data.departureTime)}
                </Text>

                <Divider />

                <View className="flex-row justify-between">
                  <Text variant="caption" tone="muted">
                    Driver
                  </Text>
                  <Text variant="caption" className="font-semibold">
                    {trip.data.driverName ?? 'Not assigned'}
                    {trip.data.driverPhone ? ` · ${trip.data.driverPhone}` : ''}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text variant="caption" tone="muted">
                    Assistant
                  </Text>
                  <Text variant="caption" className="font-semibold">
                    {trip.data.assistantName ?? 'Not assigned'}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text variant="caption" tone="muted">
                    Revenue
                  </Text>
                  <Text variant="caption" className="font-semibold">
                    {formatMoney(trip.data.revenue)}
                  </Text>
                </View>
              </Card>
            ) : null}

            {manifest.data && manifest.data.length > 0 ? (
              <View className="flex-row gap-3">
                <Card className="flex-1 items-center gap-1">
                  <UserCheck size={16} color={Colors.success} />
                  <Text variant="subtitle">
                    {boarded}/{manifest.data.length}
                  </Text>
                  <Text variant="caption" tone="muted">
                    boarded
                  </Text>
                </Card>
                <Card className="flex-1 items-center gap-1">
                  <UserX size={16} color={unpaid > 0 ? Colors.danger : Colors.textMuted} />
                  <Text variant="subtitle">{unpaid}</Text>
                  <Text variant="caption" tone="muted">
                    unpaid
                  </Text>
                </Card>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <PassengerRow entry={item} />}
        ListEmptyComponent={
          manifest.isPending ? (
            <Loading label="Loading manifest…" className="py-12" />
          ) : manifest.isError ? (
            <ErrorState
              message="Could not load the manifest."
              onRetry={() => manifest.refetch()}
              className="py-10"
            />
          ) : (
            <EmptyState
              title="No passengers yet"
              message="Confirmed bookings for this departure will appear here."
              className="py-12"
            />
          )
        }
      />
    </Screen>
  );
}
