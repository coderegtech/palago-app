import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Check, Star, X } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { SeatType, TripSeatStatus } from '@/constants/enums';
import type { TripSeatView } from '@/services/trip-service';
import { cn } from '@/utils/cn';

/** How a seat should be drawn, once selection is taken into account. */
type SeatVisual = 'available' | 'selected' | 'taken' | 'blocked';

function visualFor(seat: TripSeatView, isSelected: boolean): SeatVisual {
  if (isSelected) return 'selected';
  if (seat.status === TripSeatStatus.BLOCKED) return 'blocked';
  if (!seat.isSelectable) return 'taken';
  return 'available';
}

const seatClasses: Record<SeatVisual, string> = {
  available: 'bg-surface border-border-strong',
  selected: 'bg-primary border-primary',
  taken: 'bg-border border-border-strong',
  blocked: 'bg-background-tint border-border-strong border-dashed',
};

/**
 * Wording used for the screen-reader label and the legend.
 *
 * Status is never signalled by colour alone: a selected seat also carries a
 * tick, a blocked one a cross, and a taken one is dimmed *and* announced.
 */
const seatMeaning: Record<SeatVisual, string> = {
  available: 'available',
  selected: 'selected',
  taken: 'already taken',
  blocked: 'not for sale',
};

interface SeatProps {
  seat: TripSeatView;
  isSelected: boolean;
  onPress: (seat: TripSeatView) => void;
}

function Seat({ seat, isSelected, onPress }: SeatProps) {
  const visual = visualFor(seat, isSelected);
  const disabled = visual === 'taken' || visual === 'blocked';
  const isPriority = seat.seatType === SeatType.PRIORITY;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Seat ${seat.seatNumber}, ${seatMeaning[visual]}${
        isPriority ? ', priority seating' : ''
      }`}
      accessibilityState={{ selected: isSelected, disabled }}
      disabled={disabled}
      onPress={() => onPress(seat)}
      // 44px keeps the target tappable; the grid is sized around it.
      className={cn(
        'h-11 w-11 items-center justify-center rounded-lg border',
        seatClasses[visual],
      )}>
      {visual === 'selected' ? (
        <Check size={16} color={Colors.textInverse} />
      ) : visual === 'blocked' ? (
        <X size={14} color={Colors.textMuted} />
      ) : (
        <Text
          variant="caption"
          className={cn('font-semibold', visual === 'taken' && 'text-content-muted')}>
          {seat.seatNumber}
        </Text>
      )}

      {isPriority && visual !== 'selected' ? (
        <View className="absolute -right-1 -top-1">
          <Star size={10} color={Colors.secondaryDark} fill={Colors.secondary} />
        </View>
      ) : null}
    </Pressable>
  );
}

function LegendItem({ visual, label }: { visual: SeatVisual; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View
        className={cn('h-4 w-4 rounded border', seatClasses[visual])}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

export interface SeatMapProps {
  seats: TripSeatView[];
  selectedSeatIds: string[];
  onToggleSeat: (seat: TripSeatView) => void;
  className?: string;
}

/**
 * A 2+2 coach seat map.
 *
 * Rows come from the seat layout rather than being assumed, so a 36-seat coach
 * and a 48-seat RoRo both render correctly. The aisle is the gap between
 * columns 2 and 3.
 */
export function SeatMap({ seats, selectedSeatIds, onToggleSeat, className }: SeatMapProps) {
  const rows = useMemo(() => {
    const grouped = new Map<number, TripSeatView[]>();
    for (const seat of seats) {
      const row = grouped.get(seat.rowNumber) ?? [];
      row.push(seat);
      grouped.set(seat.rowNumber, row);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => a - b)
      .map(([rowNumber, rowSeats]) => ({
        rowNumber,
        seats: rowSeats.sort((a, b) => a.columnNumber - b.columnNumber),
      }));
  }, [seats]);

  return (
    <View className={cn('gap-4', className)}>
      <View className="flex-row flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <LegendItem visual="available" label="Available" />
        <LegendItem visual="selected" label="Selected" />
        <LegendItem visual="taken" label="Taken" />
        <LegendItem visual="blocked" label="Not for sale" />
        <View className="flex-row items-center gap-1.5">
          <Star size={12} color={Colors.secondaryDark} fill={Colors.secondary} />
          <Text variant="caption" tone="muted">
            Priority
          </Text>
        </View>
      </View>

      <View className="items-center rounded-card border border-border bg-surface p-4">
        <View className="mb-3 w-full items-center border-b border-dashed border-border pb-2">
          <Text variant="caption" tone="muted">
            Front of bus
          </Text>
        </View>

        <View className="gap-2">
          {rows.map((row) => (
            <View key={row.rowNumber} className="flex-row items-center gap-2">
              <Text variant="caption" tone="muted" className="w-4 text-right">
                {row.rowNumber}
              </Text>

              {row.seats.map((seat, index) => (
                <View key={seat.seatId} className="flex-row items-center">
                  <Seat
                    seat={seat}
                    isSelected={selectedSeatIds.includes(seat.seatId)}
                    onPress={onToggleSeat}
                  />
                  {/* Aisle: the gap after the second seat in the row. */}
                  {index === 1 && row.seats.length > 2 ? <View className="w-6" /> : null}
                </View>
              ))}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
