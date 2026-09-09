import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { CheckCircle2, QrCode } from 'lucide-react-native';

import { ReceiptCard } from '@/components/payment/receipt-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { BoardingPass } from '@/components/payment/boarding-pass';
import { useBoardingPass } from '@/hooks/use-boarding';
import { useReceipt } from '@/hooks/use-payments';
import { useBookingDetail } from '@/hooks/use-trips';
import { qrService } from '@/services/qr-service';
import { formatMoney } from '@/utils/money';

export default function ConfirmationScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const booking = useBookingDetail(bookingId ?? null);
  const receipt = useReceipt(bookingId ?? null);
  // Reaching this screen means payment just succeeded, so the pass will exist.
  const pass = useBoardingPass(bookingId ?? null);

  if (booking.isPending || receipt.isPending) {
    return (
      <Screen>
        <Header title="Booking confirmed" fallbackHref="/(user)/bookings" />
        <Loading label="Loading your confirmation…" />
      </Screen>
    );
  }

  if (booking.isError || !booking.data) {
    return (
      <Screen>
        <Header title="Booking confirmed" showBack fallbackHref="/(user)/bookings" />
        <ErrorState message="Could not load this booking." onRetry={() => booking.refetch()} />
      </Screen>
    );
  }

  const b = booking.data;

  return (
    <Screen scroll>
      {/* No back button: the funnel is finished, and going "back" would land on
          a payment screen for a booking that is already paid. */}
      <Header title="Booking confirmed" fallbackHref="/(user)/bookings" />

      <View className="items-center gap-2 py-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-success-soft">
          <CheckCircle2 size={32} color={Colors.success} />
        </View>
        <Text variant="title">Payment successful</Text>
        <Text variant="body" tone="muted" className="text-center">
          Your booking has been confirmed.
        </Text>
      </View>

      <Card className="gap-2">
        <View className="flex-row justify-between">
          <Text variant="body" tone="muted">
            Booking reference
          </Text>
          <Text variant="mono">{b.reference}</Text>
        </View>
        {receipt.data ? (
          <View className="flex-row justify-between">
            <Text variant="body" tone="muted">
              Receipt number
            </Text>
            <Text variant="mono">{receipt.data.receiptNumber}</Text>
          </View>
        ) : null}
        <View className="flex-row items-end justify-between">
          <Text variant="bodyStrong">Amount paid</Text>
          <Text variant="title" tone="primary">
            {formatMoney(b.totalAmount)}
          </Text>
        </View>
      </Card>

      {receipt.data ? (
        <View className="mt-4">
          <ReceiptCard
            receiptNumber={receipt.data.receiptNumber}
            bookingReference={b.reference}
            operatorName={b.operatorName}
            originName={b.originName}
            destinationName={b.destinationName}
            departureDate={b.departureDate}
            departureTime={b.departureTime}
            passengerNames={b.passengers.map((p) => p.name)}
            seatNumbers={b.seatNumbers}
            subtotal={b.subtotal}
            discount={b.discount}
            loyaltyDiscount={b.loyaltyDiscount}
            total={b.totalAmount}
            paymentMethod={receipt.data.paymentMethod}
            issuedAt={receipt.data.issuedAt}
          />
        </View>
      ) : null}

      {/* The boarding pass. A different QR from the payment one, and it could
          not have existed a moment ago — payment had not been confirmed. */}
      <View className="mt-4 gap-2">
        <Text variant="label" tone="muted">
          Boarding pass
        </Text>
        {pass.isPending ? (
          <Card className="py-8">
            <Loading label="Issuing your boarding pass…" />
          </Card>
        ) : pass.isError || !pass.data ? (
          <Card className="items-center gap-3 py-6">
            <QrCode size={32} color={Colors.textMuted} />
            <Text variant="bodyStrong">Boarding pass unavailable</Text>
            <Text variant="body" tone="muted" className="text-center">
              Your booking is paid. Open it from My tickets to get your pass.
            </Text>
            <Button
              label="Try again"
              variant="outline"
              fullWidth={false}
              onPress={() => pass.refetch()}
            />
          </Card>
        ) : (
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
        )}
      </View>

      <Button
        label="View booking"
        className="mt-6"
        onPress={() => router.replace({ pathname: '/bookings/[id]', params: { id: b.id } })}
      />
      <Button
        label="Done"
        variant="outline"
        className="mt-2"
        onPress={() => router.replace('/(user)/bookings')}
      />
    </Screen>
  );
}
