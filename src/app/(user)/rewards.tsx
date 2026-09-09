import { router } from 'expo-router';
import { Gift, Minus, Plus, Sparkles, TicketPercent, TrendingUp } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Header } from '@/components/ui/header';
import { Screen } from '@/components/ui/screen';
import { EmptyState, ErrorState, Loading } from '@/components/ui/states';
import { Text } from '@/components/ui/text';
import { LOYALTY_CENTAVOS_PER_POINT } from '@/constants/config';
import { DiscountType } from '@/constants/enums';
import { Colors } from '@/constants/theme';
import { useLoyalty, useLoyaltyTransactions, useRewards } from '@/hooks/use-loyalty';
import type { LoyaltyEntry, RewardOption } from '@/services/loyalty-service';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

/** What a reward is worth, in words a passenger can act on. */
function rewardValue(reward: RewardOption): string {
  if (reward.discountType === DiscountType.FIXED) {
    return `${formatMoney(reward.discountValue)} off`;
  }
  if (reward.discountType === DiscountType.PERCENTAGE) {
    const percent = reward.discountValue / 100;
    return reward.maxDiscount
      ? `${percent}% off, up to ${formatMoney(reward.maxDiscount)}`
      : `${percent}% off`;
  }
  return 'Perk';
}

function RewardCard({ reward, balance }: { reward: RewardOption; balance: number }) {
  const affordable = balance >= reward.pointsRequired;
  const short = reward.pointsRequired - balance;
  const progress = Math.min(100, Math.round((balance / reward.pointsRequired) * 100));

  return (
    <Card className={cn('gap-3', affordable && 'border-primary/40')}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-0.5">
          <Text variant="bodyStrong">{reward.name}</Text>
          <Text variant="caption" tone="muted">
            {rewardValue(reward)}
          </Text>
        </View>
        <Badge
          label={`${reward.pointsRequired} pts`}
          tone={affordable ? 'success' : 'neutral'}
        />
      </View>

      {reward.description ? (
        <Text variant="caption" tone="muted">
          {reward.description}
        </Text>
      ) : null}

      {/* Progress toward the reward, with the number spelled out — a bar alone
          tells someone they are "close" without saying how close. */}
      <View className="gap-1.5">
        <View className="h-1.5 overflow-hidden rounded-full bg-border">
          <View
            className={cn('h-full rounded-full', affordable ? 'bg-success' : 'bg-primary')}
            style={{ width: `${progress}%` }}
          />
        </View>
        <Text variant="caption" tone={affordable ? 'success' : 'muted'}>
          {affordable
            ? 'You can use this on your next booking'
            : `${short} more point${short === 1 ? '' : 's'} to go`}
        </Text>
      </View>
    </Card>
  );
}

const ENTRY_META: Record<string, { label: string; icon: React.ReactNode }> = {
  EARNED: { label: 'Trip completed', icon: <Plus size={16} color={Colors.success} /> },
  BONUS: { label: 'Bonus', icon: <Sparkles size={16} color={Colors.success} /> },
  REDEEMED: { label: 'Reward used', icon: <Minus size={16} color={Colors.danger} /> },
  EXPIRED: { label: 'Points expired', icon: <Minus size={16} color={Colors.danger} /> },
  ADJUSTED: { label: 'Points returned', icon: <Plus size={16} color={Colors.info} /> },
};

function EntryRow({ entry }: { entry: LoyaltyEntry }) {
  const meta = ENTRY_META[entry.type] ?? ENTRY_META.ADJUSTED;
  const credit = entry.points > 0;

  return (
    <View className="flex-row items-center gap-3 py-2">
      <View
        className={cn(
          'h-8 w-8 items-center justify-center rounded-full',
          credit ? 'bg-success-soft' : 'bg-danger-soft',
        )}>
        {meta.icon}
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="body">{meta.label}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {entry.reference ?? formatDate(entry.createdAt.slice(0, 10))}
        </Text>
      </View>
      <View className="items-end">
        {/* Sign, not colour, carries the direction. */}
        <Text variant="bodyStrong" tone={credit ? 'success' : 'danger'}>
          {credit ? '+' : '−'}
          {Math.abs(entry.points)}
        </Text>
        <Text variant="caption" tone="muted">
          {entry.balanceAfter} pts
        </Text>
      </View>
    </View>
  );
}

export default function RewardsScreen() {
  const loyalty = useLoyalty();
  const rewards = useRewards();
  const transactions = useLoyaltyTransactions();
  const [showHistory, setShowHistory] = useState(false);

  const balance = loyalty.data?.pointsBalance ?? 0;
  const lifetime = loyalty.data?.lifetimePoints ?? 0;

  if (loyalty.isPending) {
    return (
      <Screen>
        <Header title="Rewards" showBack fallbackHref="/(user)/home" />
        <Loading label="Loading your points…" className="py-12" />
      </Screen>
    );
  }

  if (loyalty.isError) {
    return (
      <Screen>
        <Header title="Rewards" showBack fallbackHref="/(user)/home" />
        <ErrorState message="Could not load your points." onRetry={() => loyalty.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerClassName="px-4 pb-8 gap-4" showsVerticalScrollIndicator={false}>
        <Header title="Rewards" subtitle="Points and discounts" showBack fallbackHref="/(user)/home" />

        <Card className="gap-3">
          <View className="flex-row items-center gap-2">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
              <Gift size={18} color={Colors.primary} />
            </View>
            <Text variant="label" tone="muted">
              Your points
            </Text>
          </View>

          <Text variant="display" accessibilityLabel={`${balance} points`}>
            {balance}
          </Text>

          <View className="flex-row items-center gap-1.5">
            <TrendingUp size={14} color={Colors.textMuted} />
            <Text variant="caption" tone="muted">
              {lifetime} earned all time
            </Text>
          </View>

          <Divider />

          {/*
            How points are earned, said plainly. A scheme whose rule is not
            visible reads as arbitrary, and the rule here is genuinely simple.
          */}
          <Text variant="caption" tone="muted">
            You earn 1 point for every {formatMoney(LOYALTY_CENTAVOS_PER_POINT)} you spend, and only
            once you have actually travelled — points arrive when the trip is completed, not when
            you book or pay.
          </Text>
        </Card>

        <View className="gap-1">
          <Text variant="label" tone="muted">
            Rewards
          </Text>
          <Text variant="caption" tone="muted">
            Apply one at the payment step of a booking.
          </Text>
        </View>

        {rewards.isPending ? (
          <Loading label="Loading rewards…" className="py-8" />
        ) : rewards.isError ? (
          <ErrorState message="Could not load the rewards." onRetry={() => rewards.refetch()} />
        ) : (rewards.data ?? []).length === 0 ? (
          <EmptyState title="No rewards available" message="Check back soon." />
        ) : (
          <View className="gap-3">
            {(rewards.data ?? []).map((reward) => (
              <RewardCard key={reward.id} reward={reward} balance={balance} />
            ))}
          </View>
        )}

        {balance === 0 ? (
          <Alert
            tone="info"
            title="No points yet"
            message="Book a trip and travel on it — points are added when the driver ends the trip."
          />
        ) : null}

        <Button
          label="Book a trip"
          variant="outline"
          icon={<TicketPercent size={18} color={Colors.primary} />}
          onPress={() => router.push('/booking/search')}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showHistory ? 'Hide points history' : 'Show points history'}
          accessibilityState={{ expanded: showHistory }}
          className="min-h-11 items-center justify-center"
          onPress={() => setShowHistory((open) => !open)}>
          <Text variant="bodyStrong" tone="primary">
            {showHistory ? 'Hide history' : 'Points history'}
          </Text>
        </Pressable>

        {showHistory ? (
          <Card>
            {transactions.isPending ? (
              <Loading label="Loading history…" className="py-6" />
            ) : transactions.isError ? (
              <ErrorState
                message="Could not load your history."
                onRetry={() => transactions.refetch()}
              />
            ) : (transactions.data ?? []).length === 0 ? (
              <Text variant="caption" tone="muted" className="py-4 text-center">
                Nothing here yet.
              </Text>
            ) : (
              (transactions.data ?? []).map((entry) => <EntryRow key={entry.id} entry={entry} />)
            )}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
