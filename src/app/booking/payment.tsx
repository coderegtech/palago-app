import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Gift } from 'lucide-react-native';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { BookingStatus, DiscountType } from '@/constants/enums';
import { useBooking, useCancelBooking } from '@/hooks/use-trips';
import { useCreatePayment, usePaymentForBooking } from '@/hooks/use-payments';
import { usePayBookingWithWallet, useWallet } from '@/hooks/use-wallet';
import {
  useCancelRedemption,
  useLoyalty,
  useRedeemReward,
  useRewards,
} from '@/hooks/use-loyalty';
import { Modal } from '@/components/ui/modal';
import { AppError } from '@/lib/errors';
import { useUIStore } from '@/stores/ui-store';
import { countdownUntil, formatDate, formatTime } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

/** Ticks once a second so the hold countdown stays honest. */
function useCountdown(expiresAt: string | null) {
  const [, force] = useState(0);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return expiresAt ? countdownUntil(expiresAt) : null;
}

export default function BookingPaymentScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const booking = useBooking(bookingId ?? null);
  const existingPayment = usePaymentForBooking(bookingId ?? null);
  const createPayment = useCreatePayment();
  const cancel = useCancelBooking();
  const wallet = useWallet();
  const payWithWallet = usePayBookingWithWallet();
  const loyalty = useLoyalty();
  const rewards = useRewards();
  const redeem = useRedeemReward();
  const cancelRedemption = useCancelRedemption();
  const [rewardSheet, setRewardSheet] = useState(false);
  const showToast = useUIStore((state) => state.showToast);
  const remaining = useCountdown(booking.data?.expiresAt ?? null);

  if (booking.isPending || existingPayment.isPending) {
    return (
      <Screen>
        <Header title="Payment" showBack fallbackHref="/(user)/bookings" />
        <Loading label="Loading your booking…" />
      </Screen>
    );
  }

  if (booking.isError || !booking.data) {
    return (
      <Screen>
        <Header title="Payment" showBack fallbackHref="/(user)/bookings" />
        <ErrorState message="Could not load this booking." onRetry={() => booking.refetch()} />
      </Screen>
    );
  }

  const b = booking.data;
  const payment = existingPayment.data;
  const expired = remaining === '0:00';

  // Already paid: nothing to do here.
  if (b.status === BookingStatus.CONFIRMED || payment?.status === 'PAID') {
    return (
      <Screen scroll>
        <Header title="Payment" showBack fallbackHref="/(user)/bookings" />
        <Alert
          tone="success"
          title="This booking is already paid"
          message={`Booking ${b.reference} is confirmed.`}
          className="mt-2"
        />
        <Button
          label="View confirmation"
          className="mt-4"
          onPress={() =>
            router.replace({ pathname: '/booking/confirmation', params: { bookingId: b.id } })
          }
        />
      </Screen>
    );
  }

  const walletBalance = wallet.data?.balance ?? 0;
  const walletCovers = walletBalance >= b.totalAmount;
  const pointsBalance = loyalty.data?.pointsBalance ?? 0;
  const affordableRewards = (rewards.data ?? []).filter(
    (r) => r.pointsRequired <= pointsBalance && r.discountType !== DiscountType.PERK,
  );

  function onPayWithWallet() {
    payWithWallet.mutate(b.id, {
      onSuccess: (result) => {
        showToast({
          tone: result.alreadyPaid ? 'info' : 'success',
          title: result.alreadyPaid ? 'Already paid' : 'Paid from your wallet',
          message: `${result.bookingReference} is confirmed.`,
        });
        router.replace({ pathname: '/booking/confirmation', params: { bookingId: b.id } });
      },
      onError: (error) => {
        showToast({
          tone: 'danger',
          title: 'Could not pay from the wallet',
          message:
            error instanceof AppError ? error.message : 'Please check your connection and retry.',
        });
      },
    });
  }

  function onCreatePayment() {
    createPayment.mutate(b.id, {
      onSuccess: (created) => {
        router.push({
          pathname: '/booking/payment-qr',
          params: { bookingId: b.id, paymentId: created.paymentId },
        });
      },
      onError: (error) => {
        showToast({
          tone: 'danger',
          title: 'Could not start payment',
          message:
            error instanceof AppError ? error.message : 'Please check your connection and retry.',
        });
      },
    });
  }

  return (
    <Screen scroll>
      <Header title="Payment" showBack fallbackHref="/(user)/bookings" />

      <Alert
        tone="success"
        title="Seats reserved"
        message={`Booking ${b.reference} is held for you.`}
        className="mt-2"
      />

      {b.expiresAt && !expired ? (
        <View className="mt-3 items-center rounded-card border border-warning/40 bg-warning-soft p-3">
          <Text variant="caption" tone="muted">
            Time left to pay
          </Text>
          <Text variant="display" accessibilityLabel={`${remaining} remaining`}>
            {remaining}
          </Text>
        </View>
      ) : null}

      {expired ? (
        <Alert
          tone="danger"
          title="Your hold has expired"
          message="The seats have been released. Please search again."
          className="mt-3"
        />
      ) : null}

      <Card className="mt-3 gap-3">
        <View className="flex-row items-center justify-between">
          <Badge label={b.operatorName} tone="primary" />
          <Badge label="Awaiting payment" tone="warning" />
        </View>

        <View className="gap-1">
          <Text variant="subtitle">
            {b.originCode} → {b.destinationCode}
          </Text>
          <Text variant="caption" tone="muted">
            {formatDate(b.departureDate)} · {formatTime(b.departureTime)} · {b.tripNumber}
          </Text>
        </View>

        <Divider />

        <View className="flex-row justify-between">
          <Text variant="body" tone="muted">
            Booking reference
          </Text>
          <Text variant="mono">{b.reference}</Text>
        </View>
        <View className="flex-row justify-between">
          <Text variant="body" tone="muted">
            Seats
          </Text>
          <Text variant="bodyStrong">{b.seatNumbers.join(', ')}</Text>
        </View>
        <View className="flex-row justify-between">
          <Text variant="body" tone="muted">
            Passengers
          </Text>
          <Text variant="bodyStrong">{b.passengerCount}</Text>
        </View>

        <Divider />

        {/* The discount is shown as its own line against the subtotal, so the
            passenger can see what the reward actually did rather than just a
            smaller number than they expected. */}
        {b.loyaltyDiscount > 0 ? (
          <>
            <View className="flex-row justify-between">
              <Text variant="body" tone="muted">
                Subtotal
              </Text>
              <Text variant="body">{formatMoney(b.subtotal)}</Text>
            </View>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-1.5">
                <Gift size={14} color={Colors.success} />
                <Text variant="body" tone="success">
                  Reward applied
                </Text>
              </View>
              <Text variant="body" tone="success">
                &minus;{formatMoney(b.loyaltyDiscount)}
              </Text>
            </View>
          </>
        ) : null}

        <View className="flex-row items-end justify-between">
          <Text variant="bodyStrong">Amount to pay</Text>
          <Text variant="title" tone="primary">
            {formatMoney(b.totalAmount)}
          </Text>
        </View>
      </Card>

      {/*
        Rewards must be applied BEFORE paying: the server re-derives the amount
        from the booking when confirming, so a discount added afterwards would
        make the payment refuse to confirm. The screen therefore offers this
        here and nowhere later.
      */}
      {b.loyaltyDiscount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove the applied reward"
          className="mt-3 min-h-11 items-center justify-center"
          disabled={cancelRedemption.isPending}
          onPress={() =>
            cancelRedemption.mutate(b.id, {
              onSuccess: (result) =>
                showToast({
                  tone: 'info',
                  title: 'Reward removed',
                  message: `${result.pointsReturned} points returned to your balance.`,
                }),
            })
          }>
          <Text variant="caption" tone="muted">
            Remove reward
          </Text>
        </Pressable>
      ) : affordableRewards.length > 0 ? (
        <Button
          label={`Use points (${pointsBalance} available)`}
          variant="outline"
          className="mt-3"
          icon={<Gift size={18} color={Colors.primary} />}
          disabled={expired}
          onPress={() => setRewardSheet(true)}
        />
      ) : pointsBalance > 0 ? (
        <Text variant="caption" tone="muted" className="mt-3 text-center">
          {pointsBalance} points &mdash; not enough for a reward yet.
        </Text>
      ) : null}

      {/*
        Two ways to pay, and the wallet is offered first only when it can
        actually cover the fare. An enabled button that fails on
        INSUFFICIENT_FUNDS teaches the passenger nothing; a disabled one that
        says what is short tells them exactly what to do.
      */}
      <View className="mt-6 gap-2">
        <Button
          label={payment ? 'Show payment QR' : 'Pay by QR'}
          disabled={expired}
          loading={createPayment.isPending}
          onPress={onCreatePayment}
        />

        <Button
          label={
            walletCovers
              ? `Pay ${formatMoney(b.totalAmount)} from wallet`
              : 'Wallet balance is too low'
          }
          variant="outline"
          disabled={expired || !walletCovers || wallet.isPending}
          loading={payWithWallet.isPending}
          onPress={onPayWithWallet}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open your wallet"
          className="min-h-11 items-center justify-center"
          onPress={() => router.push('/wallet')}>
          <Text variant="caption" tone="muted">
            Wallet balance {formatMoney(walletBalance)}
            {walletCovers ? '' : ` · ${formatMoney(b.totalAmount - walletBalance)} short`}
          </Text>
        </Pressable>
      </View>

      <Button
        label="Cancel booking and release seats"
        variant="ghost"
        className="mt-2"
        loading={cancel.isPending}
        onPress={() =>
          cancel.mutate(b.id, { onSuccess: () => router.replace('/(user)/bookings') })
        }
      />

      <Modal visible={rewardSheet} onClose={() => setRewardSheet(false)} title="Use your points">
        <Text variant="body" tone="muted">
          You have {pointsBalance} points. Applying a reward reduces this booking&apos;s total; the
          points are returned if you cancel.
        </Text>

        <View className="mt-4 gap-2">
          {affordableRewards.map((reward) => (
            <Pressable
              key={reward.id}
              accessibilityRole="button"
              accessibilityLabel={`Use ${reward.name} for ${reward.pointsRequired} points`}
              disabled={redeem.isPending}
              onPress={() =>
                redeem.mutate(
                  { bookingId: b.id, rewardId: reward.id },
                  {
                    onSuccess: (result) => {
                      setRewardSheet(false);
                      showToast({
                        tone: 'success',
                        title: 'Reward applied',
                        message: `${formatMoney(result.discount)} off. ${result.pointsBalance} points left.`,
                      });
                    },
                    onError: (error) => {
                      showToast({
                        tone: 'danger',
                        title: 'Could not apply that reward',
                        message: error instanceof AppError ? error.message : 'Please try again.',
                      });
                    },
                  },
                )
              }>
              <Card className="flex-row items-center justify-between gap-3">
                <View className="flex-1 gap-0.5">
                  <Text variant="bodyStrong">{reward.name}</Text>
                  <Text variant="caption" tone="muted">
                    {reward.discountType === DiscountType.FIXED
                      ? `${formatMoney(reward.discountValue)} off`
                      : `${reward.discountValue / 100}% off${
                          reward.maxDiscount ? `, up to ${formatMoney(reward.maxDiscount)}` : ''
                        }`}
                  </Text>
                </View>
                <Badge label={`${reward.pointsRequired} pts`} tone="primary" />
              </Card>
            </Pressable>
          ))}
        </View>

        <Button
          label="Not now"
          variant="outline"
          className="mt-4"
          onPress={() => setRewardSheet(false)}
        />
      </Modal>
    </Screen>
  );
}
