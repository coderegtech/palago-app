import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ArrowRight, Bus, Calendar, Clock, QrCode, User } from 'lucide-react-native';

import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { BookingStatus, PassengerType } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { BoardingPass } from '@/components/payment/boarding-pass';
import { useBoardingPass } from '@/hooks/use-boarding';
import { useBookingDetail, useCancelBooking } from '@/hooks/use-trips';
import { qrService } from '@/services/qr-service';
import { AppError } from '@/lib/errors';
import { useUIStore } from '@/stores/ui-store';
import { formatDate, formatDuration, formatTime } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

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

const passengerTypeLabel: Record<PassengerType, string> = {
  [PassengerType.ADULT]: 'Adult',
  [PassengerType.CHILD]: 'Child',
  [PassengerType.SENIOR]: 'Senior',
  [PassengerType.STUDENT]: 'Student',
  [PassengerType.PWD]: 'PWD',
};

/** Statuses a passenger may still call off themselves. */
const CANCELLABLE: BookingStatus[] = [BookingStatus.PENDING, BookingStatus.PAYMENT_PENDING];

/** Statuses that mean the booking is paid for, so a boarding pass exists. */
const PASS_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
  BookingStatus.BOARDED,
  BookingStatus.ON_TRIP,
  BookingStatus.COMPLETED,
];

function DetailRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View className="flex-row items-center gap-3">
      {icon}
      <Text variant="body" tone="muted" className="flex-1">
        {label}
      </Text>
      <Text variant="bodyStrong" className="shrink-0">
        {value}
      </Text>
    </View>
  );
}

export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useBookingDetail(id ?? null);
  const cancel = useCancelBooking();
  // Statuses that mean payment went through, so a pass can exist.
  const canHavePass = PASS_STATUSES.includes(booking.data?.status as BookingStatus);
  const pass = useBoardingPass(id ?? null, canHavePass);
  const showToast = useUIStore((state) => state.showToast);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  if (booking.isPending) {
    return (
      <Screen>
        <Header title="Booking" showBack fallbackHref="/(user)/bookings" />
        <Loading label="Loading your booking…" />
      </Screen>
    );
  }

  if (booking.isError || !booking.data) {
    return (
      <Screen>
        <Header title="Booking" showBack fallbackHref="/(user)/bookings" />
        <ErrorState
          message="Could not load this booking. It may have been cancelled."
          onRetry={() => booking.refetch()}
        />
      </Screen>
    );
  }

  const b = booking.data;
  const status = statusPresentation[b.status];
  const canCancel = CANCELLABLE.includes(b.status);
  const awaitingPayment = b.status === BookingStatus.PAYMENT_PENDING;

  function onCancel() {
    setConfirmingCancel(false);
    cancel.mutate(b.id, {
      onSuccess: () => {
        showToast({
          tone: 'success',
          title: 'Booking cancelled',
          message: 'Your seats have been released.',
        });
      },
      onError: (error) => {
        showToast({
          tone: 'danger',
          title: 'Could not cancel',
          message:
            error instanceof AppError ? error.message : 'Please check your connection and retry.',
        });
      },
    });
  }

  return (
    <Screen scroll>
      <Header
        title={b.reference}
        subtitle={b.operatorName}
        showBack
        fallbackHref="/(user)/bookings"
        right={<Badge label={status.label} tone={status.tone} />}
      />

      {awaitingPayment ? (
        <Alert
          tone="warning"
          title="Payment not completed"
          message="Your seats are held until the payment window closes."
          className="mt-2"
        />
      ) : null}

      {b.status === BookingStatus.CANCELLED ? (
        <Alert
          tone="danger"
          title="This booking was cancelled"
          message="The seats have been released back to the trip."
          className="mt-2"
        />
      ) : null}

      {/* Journey */}
      <Card className="mt-3 gap-4">
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text variant="title">{formatTime(b.departureTime)}</Text>
            <Text variant="bodyStrong">{b.originCode}</Text>
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {b.originName}
            </Text>
          </View>

          <View className="items-center gap-1 px-1">
            <ArrowRight size={18} color={Colors.primary} />
            <Text variant="caption" tone="muted">
              {formatDuration(b.durationMinutes)}
            </Text>
          </View>

          <View className="flex-1 items-end">
            <Text variant="title">{formatTime(b.arrivalTime)}</Text>
            <Text variant="bodyStrong">{b.destinationCode}</Text>
            <Text variant="caption" tone="muted" numberOfLines={2} className="text-right">
              {b.destinationName}
            </Text>
          </View>
        </View>

        <Divider />

        <View className="gap-3">
          <DetailRow
            icon={<Calendar size={16} color={Colors.textMuted} />}
            label="Travel date"
            value={formatDate(b.departureDate)}
          />
          <DetailRow
            icon={<Bus size={16} color={Colors.textMuted} />}
            label="Bus"
            value={b.busNumber}
          />
          <DetailRow
            icon={<Clock size={16} color={Colors.textMuted} />}
            label="Trip number"
            value={b.tripNumber}
          />
        </View>
      </Card>

      {/* Passengers */}
      <View className="mt-4 gap-2">
        <Text variant="label" tone="muted">
          Passengers
        </Text>
        <Card className="gap-3">
          {b.passengers.map((passenger, index) => (
            <View key={passenger.id}>
              {index > 0 ? <Divider className="mb-3" /> : null}
              <View className="flex-row items-center gap-3">
                <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
                  <User size={16} color={Colors.primary} />
                </View>
                <View className="flex-1">
                  <Text variant="bodyStrong">{passenger.name}</Text>
                  <Text variant="caption" tone="muted">
                    {passengerTypeLabel[passenger.type]}
                  </Text>
                </View>
                <Badge label={`Seat ${passenger.seatNumber}`} tone="primary" />
              </View>
            </View>
          ))}
        </Card>
      </View>

      {/* Fare breakdown */}
      <View className="mt-4 gap-2">
        <Text variant="label" tone="muted">
          Fare
        </Text>
        <Card className="gap-2">
          <View className="flex-row justify-between">
            <Text variant="body" tone="muted">
              Subtotal
            </Text>
            <Text variant="bodyStrong">{formatMoney(b.subtotal)}</Text>
          </View>

          {b.discount > 0 ? (
            <View className="flex-row justify-between">
              <Text variant="body" tone="muted">
                Discount
              </Text>
              <Text variant="bodyStrong" tone="success">
                −{formatMoney(b.discount)}
              </Text>
            </View>
          ) : null}

          {b.loyaltyDiscount > 0 ? (
            <View className="flex-row justify-between">
              <Text variant="body" tone="muted">
                Loyalty discount
              </Text>
              <Text variant="bodyStrong" tone="success">
                −{formatMoney(b.loyaltyDiscount)}
              </Text>
            </View>
          ) : null}

          <Divider className="my-1" />

          <View className="flex-row items-end justify-between">
            <Text variant="bodyStrong">Total</Text>
            <Text variant="title" tone="primary">
              {formatMoney(b.totalAmount)}
            </Text>
          </View>
        </Card>
      </View>

      {/* The boarding pass. Requested only for a booking that has actually been
          paid — asking earlier is a guaranteed refusal, which is the point. */}
      <View className="mt-4 gap-2">
        <Text variant="label" tone="muted">
          Boarding pass
        </Text>

        {!canHavePass ? (
          <Card className="items-center gap-3 py-6">
            <QrCode size={32} color={Colors.textMuted} />
            <Text variant="bodyStrong">No boarding pass yet</Text>
            <Text variant="body" tone="muted" className="text-center">
              A boarding pass is only issued once payment is confirmed.
            </Text>
          </Card>
        ) : pass.isPending ? (
          <Card className="py-8">
            <Loading label="Preparing your boarding pass…" />
          </Card>
        ) : pass.isError ? (
          <Card className="items-center gap-3 py-6">
            <QrCode size={32} color={Colors.textMuted} />
            <Text variant="bodyStrong">Boarding pass unavailable</Text>
            <Text variant="body" tone="muted" className="text-center">
              {pass.error instanceof AppError
                ? pass.error.message
                : 'Could not load your boarding pass.'}
            </Text>
            <Button
              label="Try again"
              variant="outline"
              fullWidth={false}
              onPress={() => pass.refetch()}
            />
          </Card>
        ) : pass.data ? (
          <BoardingPass
            value={qrService.toQRString(pass.data)}
            reference={b.reference}
            passengerNames={b.passengers.map((p) => p.name)}
            seatNumbers={b.seatNumbers}
            operatorName={b.operatorName}
            originCode={b.originCode}
            destinationCode={b.destinationCode}
            boardedAt={b.boardedAt}
          />
        ) : null}
      </View>

      {awaitingPayment ? (
        <Button
          label="Continue to payment"
          className="mt-6"
          onPress={() =>
            router.push({ pathname: '/booking/payment', params: { bookingId: b.id } })
          }
        />
      ) : null}

      {canCancel ? (
        <Button
          label="Cancel booking"
          variant="outline"
          className="mt-3"
          loading={cancel.isPending}
          onPress={() => setConfirmingCancel(true)}
        />
      ) : null}

      <Text variant="caption" tone="muted" className="mt-4 text-center">
        Booked {formatDate(b.createdAt.slice(0, 10))}
      </Text>

      {/*
        Cancellation releases seats and cannot be undone, so it is confirmed
        explicitly and the backdrop will not dismiss it by accident.
      */}
      <Modal
        visible={confirmingCancel}
        onClose={() => setConfirmingCancel(false)}
        title="Cancel this booking?"
        dismissOnBackdropPress={false}>
        <View className="gap-4 pt-2">
          <Text variant="body" tone="muted">
            Seats {b.seatNumbers.join(', ')} on {b.tripNumber} will be released and offered to other
            passengers. This cannot be undone.
          </Text>
          <Button label="Yes, cancel booking" variant="danger" onPress={onCancel} />
          <Button
            label="Keep my booking"
            variant="ghost"
            onPress={() => setConfirmingCancel(false)}
          />
        </View>
      </Modal>
    </Screen>
  );
}
