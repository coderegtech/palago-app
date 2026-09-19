import { router } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Wallet as WalletIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import {
  WALLET_MAX_BALANCE,
  WALLET_MAX_TOP_UP,
  WALLET_TOP_UP_PRESETS,
} from '@/constants/config';
import { WalletTransactionType } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useTopUpWallet, useWallet, useWalletTransactions } from '@/hooks/use-wallet';
import { AppError } from '@/lib/errors';
import type { WalletEntry } from '@/services/wallet-service';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/utils/cn';
import { formatTimestampDate } from '@/utils/datetime';
import { formatMoney, pesosToCentavos } from '@/utils/money';

/**
 * How each ledger entry reads.
 *
 * The icon and the sign carry the same information deliberately: direction must
 * not depend on colour alone, and a debit that only differs from a credit by
 * being red is unreadable to a good share of passengers.
 */
const ENTRY_META: Record<
  WalletTransactionType,
  { label: string; icon: React.ReactNode; tone: 'success' | 'danger' | 'info' | 'neutral' }
> = {
  TOP_UP: {
    label: 'Top-up',
    icon: <ArrowDownLeft size={16} color={Colors.success} />,
    tone: 'success',
  },
  BOOKING_PAYMENT: {
    label: 'Booking payment',
    icon: <ArrowUpRight size={16} color={Colors.danger} />,
    tone: 'danger',
  },
  REFUND: {
    label: 'Refund',
    icon: <RotateCcw size={16} color={Colors.info} />,
    tone: 'info',
  },
  REWARD: {
    label: 'Reward',
    icon: <Gift size={16} color={Colors.info} />,
    tone: 'info',
  },
  ADJUSTMENT: {
    label: 'Adjustment',
    icon: <SlidersHorizontal size={16} color={Colors.textMuted} />,
    tone: 'neutral',
  },
};

function EntryRow({ entry }: { entry: WalletEntry }) {
  const meta = ENTRY_META[entry.type] ?? ENTRY_META.ADJUSTMENT;
  const credit = entry.amount > 0;

  return (
    <Card className="flex-row items-center gap-3">
      <View
        className={cn(
          'h-9 w-9 items-center justify-center rounded-full',
          credit ? 'bg-success-soft' : 'bg-danger-soft',
        )}>
        {meta.icon}
      </View>

      <View className="flex-1 gap-0.5">
        <Text variant="bodyStrong">{meta.label}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {entry.reference ?? entry.description ?? formatTimestampDate(entry.createdAt)}
        </Text>
      </View>

      <View className="items-end gap-0.5">
        {/* The sign is explicit, so direction never rests on colour. */}
        <Text variant="bodyStrong" tone={credit ? 'success' : 'danger'}>
          {credit ? '+' : '−'}
          {formatMoney(Math.abs(entry.amount))}
        </Text>
        <Text variant="caption" tone="muted">
          Balance {formatMoney(entry.balanceAfter)}
        </Text>
      </View>
    </Card>
  );
}

export default function WalletScreen() {
  const wallet = useWallet();
  const transactions = useWalletTransactions();
  const topUp = useTopUpWallet();
  const showToast = useUIStore((state) => state.showToast);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [customPesos, setCustomPesos] = useState('');
  /*
    One key per opening of the sheet, sent with the top-up. A retry after a
    dropped response then credits once instead of twice — the server refuses the
    duplicate on this key rather than trusting the client to only tap once.
  */
  const [attemptKey, setAttemptKey] = useState(() => `topup-${Date.now()}`);

  const balance = wallet.data?.balance ?? 0;

  function openSheet() {
    setAttemptKey(`topup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setCustomPesos('');
    topUp.reset();
    setSheetOpen(true);
  }

  function submit(amount: number) {
    if (amount <= 0) return;

    topUp.mutate(
      { amount, idempotencyKey: attemptKey },
      {
        onSuccess: (result) => {
          setSheetOpen(false);
          showToast({
            tone: result.alreadyApplied ? 'info' : 'success',
            title: result.alreadyApplied ? 'Already added' : 'Balance added',
            message: result.alreadyApplied
              ? 'That top-up had already gone through, so nothing was added again.'
              : `${formatMoney(amount)} added to your balance.`,
          });
        },
        onError: (error) => {
          showToast({
            tone: 'danger',
            title: 'Could not add balance',
            message: error instanceof AppError ? error.message : 'Please try again.',
          });
        },
      },
    );
  }

  const customCentavos = customPesos.trim() ? pesosToCentavos(Number(customPesos)) : 0;
  const customValid =
    Number.isFinite(customCentavos) &&
    customCentavos > 0 &&
    customCentavos <= WALLET_MAX_TOP_UP &&
    balance + customCentavos <= WALLET_MAX_BALANCE;

  if (wallet.isPending) {
    return (
      <Screen>
        <Header title="Wallet" showBack fallbackHref="/(user)/home" />
        <Loading label="Loading your wallet…" className="py-12" />
      </Screen>
    );
  }

  if (wallet.isError) {
    return (
      <Screen>
        <Header title="Wallet" showBack fallbackHref="/(user)/home" />
        <ErrorState message="Could not load your wallet." onRetry={() => wallet.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={transactions.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-4 pb-8 gap-3"
        showsVerticalScrollIndicator={false}
        refreshing={transactions.isFetching}
        onRefresh={() => {
          transactions.refetch();
          wallet.refetch();
        }}
        ListHeaderComponent={
          <View className="gap-4 pb-1">
            <Header title="Wallet" subtitle="Balance" showBack fallbackHref="/(user)/home" />

            <Card className="gap-3">
              <View className="flex-row items-center gap-2">
                <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
                  <WalletIcon size={18} color={Colors.primary} />
                </View>
                <Text variant="label" tone="muted">
                  Available balance
                </Text>
              </View>

              <Text variant="display" accessibilityLabel={`Balance ${formatMoney(balance)}`}>
                {formatMoney(balance)}
              </Text>

              <Text variant="caption" tone="muted">
                Limit {formatMoney(WALLET_MAX_BALANCE)}
              </Text>

              <Divider />

              <Button
                label="Add balance"
                icon={<Plus size={18} color={Colors.surface} />}
                onPress={openSheet}
              />
              <Button
                label="Use it on a trip"
                variant="outline"
                onPress={() => router.push('/booking/search')}
              />
            </Card>

            <Text variant="label" tone="muted">
              Transactions
            </Text>
          </View>
        }
        renderItem={({ item }) => <EntryRow entry={item} />}
        ListEmptyComponent={
          transactions.isPending ? (
            <Loading label="Loading transactions…" className="py-8" />
          ) : transactions.isError ? (
            <ErrorState
              message="Could not load your transactions."
              onRetry={() => transactions.refetch()}
            />
          ) : (
            <EmptyState
              title="No transactions yet"
              message="Add some balance, or pay for a booking from your wallet, and it will show up here."
            />
          )
        }
      />

      <Modal
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Add balance">
        <Text variant="body" tone="muted">
          Choose an amount to add to your wallet balance.
        </Text>

        <View className="mt-4 flex-row flex-wrap gap-2">
          {WALLET_TOP_UP_PRESETS.map((amount) => {
            const wouldExceed = balance + amount > WALLET_MAX_BALANCE;
            return (
              <Pressable
                key={amount}
                accessibilityRole="button"
                accessibilityLabel={`Add ${formatMoney(amount)} to your balance`}
                accessibilityState={{ disabled: wouldExceed }}
                disabled={wouldExceed || topUp.isPending}
                onPress={() => submit(amount)}
                className={cn(
                  'min-h-11 flex-1 items-center justify-center rounded-card border px-3 py-2',
                  wouldExceed ? 'border-border bg-background-tint' : 'border-primary bg-primary-soft',
                )}>
                <Text variant="bodyStrong" tone={wouldExceed ? 'muted' : 'primary'}>
                  {formatMoney(amount)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Input
          label="Or another amount (₱)"
          placeholder="e.g. 750"
          keyboardType="decimal-pad"
          value={customPesos}
          onChangeText={setCustomPesos}
          containerClassName="mt-4"
          error={
            customPesos.trim() && !customValid
              ? customCentavos > WALLET_MAX_TOP_UP
                ? `The most you can add at once is ${formatMoney(WALLET_MAX_TOP_UP)}.`
                : balance + customCentavos > WALLET_MAX_BALANCE
                  ? `That would take the wallet over its ${formatMoney(WALLET_MAX_BALANCE)} limit.`
                  : 'Enter an amount in pesos.'
              : undefined
          }
        />

        <Button
          label="Add balance"
          className="mt-4"
          disabled={!customValid}
          loading={topUp.isPending}
          onPress={() => submit(customCentavos)}
        />
        <Button
          label="Cancel"
          variant="outline"
          className="mt-2"
          onPress={() => setSheetOpen(false)}
        />
      </Modal>
    </Screen>
  );
}
