import { router } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';
import { Ticket } from 'lucide-react-native';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { BookingStatus } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useBookings } from '@/hooks/use-trips';
import type { BookingSummary } from '@/services/booking-service';
import { formatDateShort, formatTime } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

/** Status wording and tone. Text carries the meaning; tone only reinforces it. */
const statusPresentation: Record<BookingStatus, { label: string; tone: BadgeTone }> = {
  [BookingStatus.PENDING]: { label: 'Pending', tone: 'neutral' },
  [BookingStatus.PAYMENT_PENDING]: { label: 'Awaiting payment', tone: 'warning' },
  [BookingStatus.CONFIRMED]: { label: 'Confirmed', tone: 'success' },
  [BookingStatus.CHECKED_IN]: { label: 'Checked in', tone: 'info' },
  [BookingStatus.BOARDED]: { label: 'Boarded', tone: 'info' },
  [BookingStatus.ON_TRIP]: { label: 'On trip', tone: 'info' },
  [BookingStatus.COMPLETED]: { label: 'Completed', tone: 'neutral' },
  [BookingStatus.CANCELLED]: { label: 'Cancelled', tone: 'danger' },
  [BookingStatus.REFUNDED]: { label: 'Refunded', tone: 'neutral' },
  [BookingStatus.NO_SHOW]: { label: 'No show', tone: 'danger' },
};

function BookingRow({ booking }: { booking: BookingSummary }) {
  const status = statusPresentation[booking.status];
  const awaitingPayment = booking.status === BookingStatus.PAYMENT_PENDING;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Booking ${booking.reference}, ${booking.originCode} to ${booking.destinationCode}, ${status.label}`}
      onPress={() =>
        awaitingPayment
          ? router.push({ pathname: '/booking/payment', params: { bookingId: booking.id } })
          : router.push({ pathname: '/bookings/[id]', params: { id: booking.id } })
      }>
      <Card className="gap-3 active:bg-primary-soft">
        <View className="flex-row items-center justify-between">
          <Badge label={booking.operatorName} tone="primary" />
          <Badge label={status.label} tone={status.tone} />
        </View>

        <View className="gap-0.5">
          <Text variant="subtitle">
            {booking.originCode} → {booking.destinationCode}
          </Text>
          <Text variant="caption" tone="muted">
            {formatDateShort(booking.departureDate)} · {formatTime(booking.departureTime)}
          </Text>
        </View>

        <View className="flex-row items-end justify-between border-t border-border pt-3">
          <View>
            <Text variant="mono" className="text-[12px]">
              {booking.reference}
            </Text>
            <Text variant="caption" tone="muted">
              {booking.passengerCount}{' '}
              {booking.passengerCount === 1 ? 'passenger' : 'passengers'} · Seat
              {booking.seatNumbers.length === 1 ? '' : 's'} {booking.seatNumbers.join(', ')}
            </Text>
          </View>
          <Text variant="bodyStrong" tone="primary">
            {formatMoney(booking.totalAmount)}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

export default function BookingsScreen() {
  const bookings = useBookings();

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="My tickets" />
      </View>

      {bookings.isPending ? (
        <Loading label="Loading your tickets…" />
      ) : bookings.isError ? (
        <ErrorState
          message="Could not load your bookings. Check your connection and try again."
          onRetry={() => bookings.refetch()}
        />
      ) : (
        <FlatList
          data={bookings.data}
          keyExtractor={(booking) => booking.id}
          contentContainerClassName="px-4 pb-8 gap-3"
          refreshing={bookings.isFetching}
          onRefresh={() => bookings.refetch()}
          renderItem={({ item }) => <BookingRow booking={item} />}
          ListEmptyComponent={
            <EmptyState
              icon={<Ticket size={40} color={Colors.textMuted} />}
              title="No tickets yet"
              message="Book a Cherry Bus or RoRo Bus trip and it will appear here."
              actionLabel="Search trips"
              onAction={() => router.push('/booking/search')}
              className="py-16"
            />
          }
          ListFooterComponent={
            bookings.data && bookings.data.length > 0 ? (
              <Button
                label="Book another trip"
                variant="outline"
                className="mt-2"
                onPress={() => router.push('/booking/search')}
              />
            ) : null
          }
        />
      )}
    </Screen>
  );
}
