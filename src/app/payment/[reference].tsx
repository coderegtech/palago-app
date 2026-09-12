import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { CheckCircle2 } from 'lucide-react-native';

import { BrandHero } from '@/components/common/brand-hero';
import { ReceiptCard } from '@/components/payment/receipt-card';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { ErrorCode } from '@/constants/errors';
import { Colors } from '@/constants/theme';
import { useConfirmPayment, usePublicPayment } from '@/hooks/use-payments';
import { AppError } from '@/lib/errors';
import { formatDate, formatTime } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

/**
 * PalaGo test payment page — the target of the payment QR.
 *
 * PUBLIC BY DESIGN. It opens in whatever browser scanned the QR, with no PalaGo
 * session. Authorisation is the `t` token from the QR, which every request
 * carries and the server validates. That is why the root layout has no auth
 * gate and imports no native modules.
 *
 * Confirming does NOT write to the database from here. It calls the
 * `confirm-test-payment` Edge Function, which does the whole transition —
 * payment, receipt, booking, seats, audit, notification — server-side.
 *
 * NO REAL MONEY IS EVER CHARGED. No payment provider is contacted.
 */
export default function PaymentPage() {
  const { reference, t } = useLocalSearchParams<{ reference: string; t?: string }>();
  const token = t ?? null;

  const payment = usePublicPayment(reference ?? null, token);
  const confirm = useConfirmPayment();
  const [confirmed, setConfirmed] = useState(false);

  // A link without a token cannot be authorised, and saying so plainly beats a
  // generic failure — the usual cause is a copied URL with the query dropped.
  if (!token) {
    return (
      <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
        <BrandHero title="Payment Confirmation" size="md" withTagline={false} />
        <Alert
          tone="danger"
          title="This payment link is incomplete"
          message="Scan the QR code in the PalaGo app again. The link must include its security token."
          className="mt-6"
        />
      </Screen>
    );
  }

  if (payment.isPending) {
    return (
      <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
        <BrandHero title="Payment Confirmation" size="md" withTagline={false} />
        <Loading label="Loading payment…" className="py-16" />
      </Screen>
    );
  }

  if (payment.isError || !payment.data) {
    const notFound =
      payment.error instanceof AppError &&
      (payment.error.code === ErrorCode.NOT_FOUND || payment.error.code === ErrorCode.INVALID_QR);

    return (
      <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
        <BrandHero title="Payment Confirmation" size="md" withTagline={false} />
        {notFound ? (
          <Alert
            tone="danger"
            title="Payment not found"
            message="This payment link is not valid. It may have been mistyped, or the booking may have been cancelled."
            className="mt-6"
          />
        ) : (
          <ErrorState
            message="Could not load this payment. Check your connection and try again."
            onRetry={() => payment.refetch()}
            className="py-10"
          />
        )}
      </Screen>
    );
  }

  const p = payment.data;
  const result = confirm.data;
  const isPaid = p.paymentStatus === 'PAID' || confirmed;
  const isCancelled = p.paymentStatus === 'CANCELLED' || p.bookingStatus === 'CANCELLED';
  const isExpired = p.isExpired && !isPaid;

  const receipt = result
    ? {
        receiptNumber: result.receiptNumber,
        amount: result.amount,
        currency: result.currency,
        paymentMethod: 'PalaGo Payment',
        issuedAt: result.issuedAt,
      }
    : p.receipt;

  function onConfirm() {
    confirm.mutate(
      { reference: reference!, token: token! },
      { onSuccess: () => setConfirmed(true) },
    );
  }

  const confirmError =
    confirm.error instanceof AppError
      ? confirm.error.message
      : confirm.error
        ? 'Could not confirm the payment. Please try again.'
        : null;

  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
      <BrandHero title="Payment Confirmation" size="md" withTagline={false} />

      <View className="pt-6" />

      {/* Impossible to miss, and never removed once paid. */}
      <Alert
        tone="info"
        title="Confirm your payment"
        message="Review the details below, then confirm to complete this booking."
      />

      {isPaid ? (
        <View className="mt-4 items-center gap-2">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-success-soft">
            <CheckCircle2 size={28} color={Colors.success} />
          </View>
          <Text variant="title" className="text-center">
            {result?.alreadyConfirmed || (p.paymentStatus === 'PAID' && !confirmed)
              ? 'Payment already completed'
              : 'Payment successful'}
          </Text>
          <Text variant="body" tone="muted" className="text-center">
            Booking {p.bookingReference} is confirmed. You can close this page and return to the
            PalaGo app.
          </Text>
        </View>
      ) : null}

      {isCancelled ? (
        <Alert
          tone="danger"
          title="Payment cancelled"
          message="This booking was cancelled and its seats have been released."
          className="mt-4"
        />
      ) : isExpired ? (
        <Alert
          tone="danger"
          title="Payment expired"
          message="The payment window closed and the seats were released. Please book again in the PalaGo app."
          className="mt-4"
        />
      ) : null}

      {/* Booking summary */}
      <Card className="mt-4 gap-3">
        <View className="flex-row items-center justify-between">
          <Badge label={p.operatorName} tone="primary" />
          <Badge
            label={p.paymentStatus}
            tone={isPaid ? 'success' : isCancelled || isExpired ? 'danger' : 'warning'}
          />
        </View>

        <View className="gap-1">
          <Text variant="subtitle">
            {p.originName} → {p.destinationName}
          </Text>
          <Text variant="caption" tone="muted">
            {formatDate(p.departureDate)} · {formatTime(p.departureTime)} · {p.tripNumber}
          </Text>
        </View>

        <Divider />

        <View className="gap-2">
          <View className="flex-row justify-between">
            <Text variant="caption" tone="muted">
              Booking reference
            </Text>
            <Text variant="mono" className="text-[13px]">
              {p.bookingReference}
            </Text>
          </View>
          <View className="flex-row justify-between">
            <Text variant="caption" tone="muted">
              Payment reference
            </Text>
            <Text variant="mono" className="text-[13px]">
              {p.paymentReference}
            </Text>
          </View>
        </View>

        <Divider />

        <View className="gap-2">
          <Text variant="caption" tone="muted" className="font-semibold uppercase">
            Passengers
          </Text>
          {p.passengers.map((passenger, index) => (
            // Keyed by position: before payment there is no seat to key on.
            <View key={index} className="flex-row items-center justify-between">
              <Text variant="body">{passenger.name}</Text>
              <Badge
                label={passenger.seat ? `Seat ${passenger.seat}` : 'Seat after payment'}
                tone="neutral"
              />
            </View>
          ))}
        </View>

        <Divider />

        <View className="gap-2">
          <View className="flex-row justify-between">
            <Text variant="body" tone="muted">
              Subtotal
            </Text>
            <Text variant="bodyStrong">{formatMoney(p.subtotal)}</Text>
          </View>
          {p.discount > 0 ? (
            <View className="flex-row justify-between">
              <Text variant="body" tone="muted">
                Discount
              </Text>
              <Text variant="bodyStrong" tone="success">
                −{formatMoney(p.discount)}
              </Text>
            </View>
          ) : null}
          {p.loyaltyDiscount > 0 ? (
            <View className="flex-row justify-between">
              <Text variant="body" tone="muted">
                Loyalty discount
              </Text>
              <Text variant="bodyStrong" tone="success">
                −{formatMoney(p.loyaltyDiscount)}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="flex-row items-end justify-between border-t border-border pt-3">
          <Text variant="bodyStrong">TOTAL</Text>
          <Text variant="display" tone="primary">
            {formatMoney(p.totalAmount)}
          </Text>
        </View>
      </Card>

      {confirmError ? (
        <Alert tone="danger" title="Could not confirm" message={confirmError} className="mt-4" />
      ) : null}

      {!isPaid && !isCancelled && !isExpired ? (
        <>
          <Button
            label="Confirm payment"
            className="mt-6"
            loading={confirm.isPending}
            onPress={onConfirm}
          />
          <Text variant="caption" tone="muted" className="mt-3 text-center">
            Pressing this confirms the payment and issues a receipt.
          </Text>
        </>
      ) : null}

      {receipt ? (
        <View className="mt-6">
          <ReceiptCard
            receiptNumber={receipt.receiptNumber}
            bookingReference={p.bookingReference}
            operatorName={p.operatorName}
            originName={p.originName}
            destinationName={p.destinationName}
            departureDate={p.departureDate}
            departureTime={p.departureTime}
            passengerNames={p.passengers.map((x) => x.name)}
            // The receipt is shown after payment, so seats exist by then; the
            // filter is what keeps a half-assigned booking from printing "null".
            seatNumbers={p.passengers.map((x) => x.seat).filter((seat): seat is string => Boolean(seat))}
            subtotal={p.subtotal}
            discount={p.discount}
            loyaltyDiscount={p.loyaltyDiscount}
            total={p.totalAmount}
            paymentMethod={receipt.paymentMethod}
            issuedAt={receipt.issuedAt}
          />
        </View>
      ) : null}

    </Screen>
  );
}
