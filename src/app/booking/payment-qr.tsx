import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { PaymentQR } from '@/components/payment/payment-qr';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { usePaymentForBooking, usePaymentStatusSubscription } from '@/hooks/use-payments';
import { useBooking } from '@/hooks/use-trips';
import { countdownUntil } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

function useCountdown(expiresAt: string | null) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return expiresAt ? countdownUntil(expiresAt) : null;
}

export default function PaymentQRScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const booking = useBooking(bookingId ?? null);
  const payment = usePaymentForBooking(bookingId ?? null);

  // The confirmation happens on whichever device scanned the QR, so this screen
  // waits for the database to tell it rather than asking repeatedly.
  const liveStatus = usePaymentStatusSubscription(payment.data?.id ?? null, bookingId ?? null);

  const remaining = useCountdown(payment.data?.expiresAt ?? null);
  const status = liveStatus ?? payment.data?.status ?? null;
  const isPaid = status === 'PAID';
  const expired = remaining === '0:00' && !isPaid;

  // Move on by itself once payment lands: the passenger is looking at their
  // phone waiting for exactly this.
  useEffect(() => {
    if (isPaid && bookingId) {
      router.replace({ pathname: '/booking/confirmation', params: { bookingId } });
    }
  }, [isPaid, bookingId]);

  if (booking.isPending || payment.isPending) {
    return (
      <Screen>
        <Header title="Scan to pay" showBack fallbackHref="/(user)/bookings" />
        <Loading label="Preparing your payment…" />
      </Screen>
    );
  }

  const b = booking.data;
  // Bound to consts before the guards: TypeScript narrows a const local, but
  // not a property read off a query result that could change between reads.
  const p = payment.data;

  if (booking.isError || !b) {
    return (
      <Screen>
        <Header title="Scan to pay" showBack fallbackHref="/(user)/bookings" />
        <ErrorState message="Could not load this booking." onRetry={() => booking.refetch()} />
      </Screen>
    );
  }

  if (!p?.paymentUrl) {
    return (
      <Screen>
        <Header title="Scan to pay" showBack fallbackHref="/(user)/bookings" />
        <ErrorState
          message="This booking has no active payment. Go back and start the payment again."
          onRetry={() => payment.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title="Scan to pay" subtitle={b.reference} showBack fallbackHref="/(user)/bookings" />

      {expired ? (
        <Alert
          tone="danger"
          title="This payment has expired"
          message="The seats have been released. Please search for a trip again."
          className="mt-3"
        />
      ) : (
        <>
          <View className="mt-4 items-center">
            <PaymentQR value={p.paymentUrl} />
          </View>

          <View className="mt-4 items-center gap-1">
            <Text variant="caption" tone="muted">
              Time left to pay
            </Text>
            <Text variant="title" accessibilityLabel={`${remaining} remaining`}>
              {remaining}
            </Text>
          </View>
        </>
      )}

      <Card className="mt-4 gap-2">
        <View className="flex-row justify-between">
          <Text variant="body" tone="muted">
            Payment reference
          </Text>
          <Text variant="mono">{p.reference}</Text>
        </View>
        <View className="flex-row items-end justify-between">
          <Text variant="bodyStrong">Amount to pay</Text>
          <Text variant="title" tone="primary">
            {formatMoney(p.amount)}
          </Text>
        </View>
      </Card>

      {!expired ? (
        <Card className="mt-3 flex-row items-center gap-3">
          <ActivityIndicator size="small" color={Colors.primary} />
          <View className="flex-1">
            <Text variant="bodyStrong">Waiting for payment</Text>
            <Text variant="caption" tone="muted">
              Scan the code with any phone camera, then confirm on the page that opens. This screen
              updates by itself.
            </Text>
          </View>
        </Card>
      ) : null}

      <View className="mt-3 items-center">
        <Badge label={`Status: ${status ?? 'PENDING'}`} tone={isPaid ? 'success' : 'warning'} />
      </View>

      <Text variant="caption" tone="muted" className="mt-4 text-center">
        This QR is a payment link, not your ticket. Your boarding pass is issued after payment.
      </Text>

      <Button
        label="Back to my tickets"
        variant="ghost"
        className="mt-4"
        onPress={() => router.replace('/(user)/bookings')}
      />
    </Screen>
  );
}
