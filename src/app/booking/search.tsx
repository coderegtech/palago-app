import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { ArrowUpDown, Minus, Plus, SlidersHorizontal, X } from 'lucide-react-native';

import { TripCard } from '@/components/booking/trip-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { IconButton } from '@/components/ui/icon-button';
import { Screen } from '@/components/ui/screen';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, Loading, Skeleton } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { MAX_PASSENGERS_PER_BOOKING } from '@/constants/config';
import { BusType } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useOperators, useTerminals, useTripSearch } from '@/hooks/use-trips';
import { useBookingStore } from '@/stores/booking-store';
import { tripSearchSchema, type TripSearchInput } from '@/schemas/booking';
import type { TripFilters, TripSearchResult } from '@/services/trip-service';
import { addDaysISO, formatDateShort, todayISO } from '@/utils/datetime';

/** The next seven days, as pickable chips. */
function useDateOptions() {
  return useMemo(() => {
    const today = todayISO();
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDaysISO(today, i);
      return { date, label: i === 0 ? 'Today' : formatDateShort(date) };
    });
  }, []);
}

export default function BookingSearchScreen() {
  // Arrives set when the user tapped an operator card on the home screen.
  const { operator } = useLocalSearchParams<{ operator?: string }>();
  const terminals = useTerminals();
  const operators = useOperators();
  const dateOptions = useDateOptions();
  const setSearch = useBookingStore((state) => state.setSearch);
  const selectTrip = useBookingStore((state) => state.selectTrip);

  const [origin, setOrigin] = useState<string | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [date, setDate] = useState(dateOptions[0].date);
  const [passengers, setPassengers] = useState(1);
  const [submitted, setSubmitted] = useState<TripSearchInput | null>(null);
  const [filters, setFilters] = useState<TripFilters>(
    operator ? { operatorCode: operator } : {},
  );
  // Opened when arriving with a filter already applied, so the active operator
  // is visible rather than a silent narrowing of the results.
  const [showFilters, setShowFilters] = useState(Boolean(operator));

  const search = useTripSearch(submitted, filters);

  const parsed = tripSearchSchema.safeParse({
    originTerminalId: origin,
    destinationTerminalId: destination,
    departureDate: date,
    passengers,
  });

  const terminalOptions = (terminals.data ?? []).map((t) => ({
    value: t.id,
    label: t.name,
    description: t.city,
  }));

  function onSearch() {
    if (!parsed.success) return;
    setSubmitted(parsed.data);
    setSearch(parsed.data);
  }

  function swapTerminals() {
    setOrigin(destination);
    setDestination(origin);
  }

  function onSelectTrip(trip: TripSearchResult) {
    selectTrip(trip.id, passengers);
    router.push({ pathname: '/booking/trip-details', params: { tripId: trip.id } });
  }

  // Operator codes are opaque; show the name the user actually tapped.
  const activeFilterLabel = filters.operatorCode
    ? ((operators.data ?? []).find((o) => o.code === filters.operatorCode)?.name ??
      filters.operatorCode)
    : null;

  const validationMessage =
    !parsed.success && origin && destination
      ? parsed.error.issues[0]?.message
      : null;

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Search trips" showBack />
      </View>

      <FlatList
        data={search.data ?? []}
        keyExtractor={(trip) => trip.id}
        contentContainerClassName="px-4 pb-8 gap-3"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View className="gap-3 pb-2">
            <Card className="gap-3">
              {terminals.isPending ? (
                <View className="gap-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </View>
              ) : terminals.isError ? (
                <ErrorState
                  message="Could not load terminals."
                  onRetry={() => terminals.refetch()}
                  className="py-4"
                />
              ) : (
                <>
                  <Select
                    label="From"
                    placeholder="Select origin"
                    value={origin}
                    options={terminalOptions}
                    onChange={setOrigin}
                  />

                  <View className="items-end">
                    <IconButton
                      accessibilityLabel="Swap origin and destination"
                      variant="soft"
                      onPress={swapTerminals}>
                      <ArrowUpDown size={16} color={Colors.primary} />
                    </IconButton>
                  </View>

                  <Select
                    label="To"
                    placeholder="Select destination"
                    value={destination}
                    options={terminalOptions}
                    onChange={setDestination}
                  />
                </>
              )}

              <View className="gap-2">
                <Text variant="caption" tone="muted" className="font-semibold">
                  Travel date
                </Text>
                <FlatList
                  horizontal
                  data={dateOptions}
                  keyExtractor={(option) => option.date}
                  showsHorizontalScrollIndicator={false}
                  contentContainerClassName="gap-2"
                  renderItem={({ item }) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: item.date === date }}
                      accessibilityLabel={item.label}
                      onPress={() => setDate(item.date)}
                      className={`min-h-11 justify-center rounded-full border px-4 ${
                        item.date === date
                          ? 'border-primary bg-primary'
                          : 'border-border bg-surface'
                      }`}>
                      <Text
                        variant="caption"
                        tone={item.date === date ? 'inverse' : 'default'}
                        className="font-semibold">
                        {item.label}
                      </Text>
                    </Pressable>
                  )}
                />
              </View>

              <View className="flex-row items-center justify-between">
                <Text variant="caption" tone="muted" className="font-semibold">
                  Passengers
                </Text>
                <View className="flex-row items-center gap-3">
                  <IconButton
                    accessibilityLabel="Remove a passenger"
                    variant="soft"
                    disabled={passengers <= 1}
                    onPress={() => setPassengers((n) => Math.max(1, n - 1))}>
                    <Minus size={16} color={Colors.primary} />
                  </IconButton>
                  <Text variant="subtitle" accessibilityLabel={`${passengers} passengers`}>
                    {passengers}
                  </Text>
                  <IconButton
                    accessibilityLabel="Add a passenger"
                    variant="soft"
                    disabled={passengers >= MAX_PASSENGERS_PER_BOOKING}
                    onPress={() =>
                      setPassengers((n) => Math.min(MAX_PASSENGERS_PER_BOOKING, n + 1))
                    }>
                    <Plus size={16} color={Colors.primary} />
                  </IconButton>
                </View>
              </View>

              {/*
                An active filter has to be visible before the first search, not
                just inside the filter panel — that panel only appears once
                results exist, so arriving from an operator card would otherwise
                narrow the search with nothing on screen to say so.
              */}
              {activeFilterLabel ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Filtering by ${activeFilterLabel}. Tap to clear.`}
                  onPress={() => setFilters((f) => ({ ...f, operatorCode: undefined }))}
                  className="min-h-11 flex-row items-center gap-2 self-start">
                  <Badge label={`${activeFilterLabel} only`} tone="primary" />
                  <View className="flex-row items-center gap-1">
                    <X size={12} color={Colors.textMuted} />
                    <Text variant="caption" tone="muted">
                      Clear
                    </Text>
                  </View>
                </Pressable>
              ) : null}

              {validationMessage ? (
                <Text variant="caption" tone="danger">
                  {validationMessage}
                </Text>
              ) : null}

              <Button
                label="Search buses"
                disabled={!parsed.success}
                loading={search.isFetching && submitted !== null}
                onPress={onSearch}
              />
            </Card>

            {submitted ? (
              <View className="flex-row items-center justify-between">
                <Text variant="caption" tone="muted">
                  {search.data ? `${search.data.length} trips` : 'Searching…'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Filters"
                  hitSlop={8}
                  onPress={() => setShowFilters((open) => !open)}
                  className="min-h-11 flex-row items-center gap-1.5">
                  <SlidersHorizontal size={14} color={Colors.primary} />
                  <Text variant="caption" tone="primary" className="font-semibold">
                    Filters
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {submitted && showFilters ? (
              <Card className="gap-3">
                <Text variant="caption" tone="muted" className="font-semibold">
                  Operator
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {[
                    { label: 'All', value: undefined },
                    { label: 'Cherry Bus', value: 'CHERRY' },
                    { label: 'RoRo Bus', value: 'RORO' },
                  ].map((option) => (
                    <Pressable
                      key={option.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: filters.operatorCode === option.value }}
                      onPress={() => setFilters((f) => ({ ...f, operatorCode: option.value }))}
                      className={`min-h-11 justify-center rounded-full border px-4 ${
                        filters.operatorCode === option.value
                          ? 'border-primary bg-primary-soft'
                          : 'border-border bg-surface'
                      }`}>
                      <Text variant="caption" className="font-semibold">
                        {option.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text variant="caption" tone="muted" className="font-semibold">
                  Departure
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {[
                    { label: 'Any', value: undefined },
                    { label: 'Morning', value: 'MORNING' as const },
                    { label: 'Afternoon', value: 'AFTERNOON' as const },
                    { label: 'Evening', value: 'EVENING' as const },
                  ].map((option) => (
                    <Pressable
                      key={option.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: filters.departureWindow === option.value }}
                      onPress={() => setFilters((f) => ({ ...f, departureWindow: option.value }))}
                      className={`min-h-11 justify-center rounded-full border px-4 ${
                        filters.departureWindow === option.value
                          ? 'border-primary bg-primary-soft'
                          : 'border-border bg-surface'
                      }`}>
                      <Text variant="caption" className="font-semibold">
                        {option.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text variant="caption" tone="muted" className="font-semibold">
                  Bus type
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {[
                    { label: 'Any', value: undefined },
                    { label: 'Bus', value: BusType.BUS },
                    { label: 'RoRo', value: BusType.RORO },
                  ].map((option) => (
                    <Pressable
                      key={option.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: filters.busType === option.value }}
                      onPress={() => setFilters((f) => ({ ...f, busType: option.value }))}
                      className={`min-h-11 justify-center rounded-full border px-4 ${
                        filters.busType === option.value
                          ? 'border-primary bg-primary-soft'
                          : 'border-border bg-surface'
                      }`}>
                      <Text variant="caption" className="font-semibold">
                        {option.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </Card>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <TripCard trip={item} passengers={passengers} onPress={onSelectTrip} />
        )}
        ListEmptyComponent={
          !submitted ? (
            <EmptyState
              title="Where are you headed?"
              message="Pick your origin, destination and travel date to see available buses."
              className="py-10"
            />
          ) : search.isPending ? (
            <Loading label="Finding buses…" className="py-10" />
          ) : search.isError ? (
            <ErrorState
              message="Could not load trips. Check your connection and try again."
              onRetry={() => search.refetch()}
              className="py-10"
            />
          ) : (
            <EmptyState
              title="No buses on this route"
              message={`Nothing found for ${formatDateShort(date)} with ${passengers} ${
                passengers === 1 ? 'seat' : 'seats'
              } available. Try another date.`}
              className="py-10"
            />
          )
        }
        ListFooterComponent={
          search.data && search.data.length > 0 ? (
            <View className="items-center pt-2">
            </View>
          ) : null
        }
      />
    </Screen>
  );
}
