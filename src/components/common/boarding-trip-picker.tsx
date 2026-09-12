import type { Href } from 'expo-router';
import { View } from 'react-native';
import { Bus, ScanLine } from 'lucide-react-native';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { useSetTripBoarding } from '@/hooks/use-tracking';
import { AppError } from '@/lib/errors';

import { type BoardingDoor, doorLabel, isBoardable } from './boarding-door';

export interface BoardingTripPickerProps {
  doors: BoardingDoor[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onChoose: (door: BoardingDoor) => void;
  /**
   * Operators and assigned drivers may open boarding; assistants may scan but
   * not open it (see `can_manage_trip_status`). Showing them a button the
   * server will refuse would be a button that lies.
   */
  canOpenBoarding: boolean;
  subtitle?: string;
  showBack?: boolean;
  fallbackHref?: Href;
}

/**
 * Choose which bus you are boarding.
 *
 * A scan is only ever judged against one trip, so the scanner is opened from
 * here rather than on its own. Trips that have left are not listed — they are
 * done boarding.
 */
export function BoardingTripPicker({
  doors,
  isPending,
  isError,
  onRetry,
  onChoose,
  canOpenBoarding,
  subtitle,
  showBack,
  fallbackHref,
}: BoardingTripPickerProps) {
  const open = useSetTripBoarding();

  const header = (
    <Header
      title="Scanner"
      subtitle={subtitle ?? 'Choose the bus you are boarding'}
      showBack={showBack}
      fallbackHref={fallbackHref}
    />
  );

  if (isPending) {
    return (
      <Screen>
        {header}
        <Loading label="Loading trips…" />
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen>
        {header}
        <ErrorState message="Could not load the trips you can board." onRetry={onRetry} />
      </Screen>
    );
  }

  const boardable = (doors ?? [])
    .filter(isBoardable)
    .sort((a, b) =>
      `${a.departureDate} ${a.departureTime}`.localeCompare(`${b.departureDate} ${b.departureTime}`),
    );

  return (
    <Screen scroll>
      {header}

      {boardable.length === 0 ? (
        <EmptyState
          title="No trips to board"
          message="Trips that are scheduled or boarding appear here. Ones that have already left do not."
          icon={<Bus size={28} color={Colors.textMuted} />}
        />
      ) : (
        <View className="gap-3">
          {open.error ? (
            <Alert
              tone="danger"
              title="Boarding did not open"
              message={
                open.error instanceof AppError ? open.error.message : 'Check your connection and try again.'
              }
            />
          ) : null}

          {boardable.map((door) => {
            const isBoarding = door.status === 'BOARDING';
            const opening = open.isPending && open.variables === door.tripId;

            return (
              <Card key={door.tripId} className="gap-3">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <Text variant="mono">{door.tripNumber}</Text>
                    <Text variant="bodyStrong">{doorLabel(door)}</Text>
                    <Text variant="caption" tone="muted">
                      {door.boardedCount} of {door.passengerCount} boarded
                    </Text>
                  </View>
                  <Badge
                    label={isBoarding ? 'Boarding' : 'Not open yet'}
                    tone={isBoarding ? 'success' : 'neutral'}
                  />
                </View>

                {isBoarding ? (
                  <Button
                    label="Scan passengers"
                    icon={<ScanLine size={18} color={Colors.surface} />}
                    onPress={() => onChoose(door)}
                    accessibilityLabel={`Scan passengers for ${door.tripNumber}`}
                  />
                ) : canOpenBoarding ? (
                  <Button
                    label="Open boarding"
                    variant="outline"
                    loading={opening}
                    disabled={open.isPending}
                    onPress={() =>
                      open.mutate(door.tripId, {
                        onSuccess: () => onChoose({ ...door, status: 'BOARDING' }),
                      })
                    }
                    accessibilityLabel={`Open boarding for ${door.tripNumber}`}
                  />
                ) : (
                  <Text variant="caption" tone="muted">
                    The driver has not opened boarding for this trip yet.
                  </Text>
                )}
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
