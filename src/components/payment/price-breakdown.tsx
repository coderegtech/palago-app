/**
 * What a booking costs, line by line — the same on every screen that shows it:
 * payment, booking detail, receipt and the public payment page.
 *
 *   Base fare         ₱XXX
 *   Discount          −₱XX    (senior / student / PWD)
 *   Reward            −₱XX    (only when one is applied)
 *   Convenience fee    ₱10
 *   Total             ₱XXX
 *
 * Every figure comes from the booking the server priced. The lines are laid out
 * here, never added up here: `total` is the server's `total_amount`, and the
 * breakdown's own sum is checked against it so a screen can never show lines
 * that disagree with what the passenger is charged.
 */

import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { Centavos } from '@/types/models';
import { cn } from '@/utils/cn';
import { formatMoney } from '@/utils/money';

export interface PriceBreakdownInput {
  subtotal: Centavos;
  discount: Centavos;
  loyaltyDiscount: Centavos;
  convenienceFee: Centavos;
  totalAmount: Centavos;
}

export interface PriceLine {
  key: 'fare' | 'discount' | 'reward' | 'fee';
  label: string;
  /** Signed: a reduction is negative. */
  amount: Centavos;
}

export function priceLines(b: PriceBreakdownInput): PriceLine[] {
  const lines: PriceLine[] = [
    { key: 'fare', label: 'Base fare', amount: b.subtotal },
    // `|| 0` so no discount prints ₱0.00, not −₱0.00 (-0 is still negative to Intl).
    { key: 'discount', label: 'Discount', amount: b.discount ? -b.discount : 0 },
  ];
  if (b.loyaltyDiscount > 0) {
    lines.push({ key: 'reward', label: 'Reward applied', amount: -b.loyaltyDiscount });
  }
  // Omitted, not shown as ₱0.00, on bookings made before the fee existed: they
  // never had one, and a zero line would read as a fee that was waived.
  if (b.convenienceFee > 0) {
    lines.push({ key: 'fee', label: 'Convenience fee', amount: b.convenienceFee });
  }
  return lines;
}

/** True when the lines add up to the server's total — they always should. */
export function breakdownAddsUp(b: PriceBreakdownInput): boolean {
  return priceLines(b).reduce((sum, line) => sum + line.amount, 0) === b.totalAmount;
}

function formatLine(amount: Centavos): string {
  return amount < 0 ? `−${formatMoney(-amount)}` : formatMoney(amount);
}

export interface PriceBreakdownProps extends PriceBreakdownInput {
  /** Label on the final line. */
  totalLabel?: string;
  className?: string;
}

export function PriceBreakdown({
  totalLabel = 'Total amount',
  className,
  ...b
}: PriceBreakdownProps) {
  const lines = priceLines(b);

  return (
    <View className={cn('gap-2', className)}>
      {lines.map((line) => (
        <View key={line.key} className="flex-row items-center justify-between gap-3">
          <Text variant="body" tone={line.key === 'reward' ? 'success' : 'muted'}>
            {line.label}
          </Text>
          <Text variant="body" tone={line.key === 'reward' ? 'success' : 'default'}>
            {formatLine(line.amount)}
          </Text>
        </View>
      ))}

      <View className="flex-row items-end justify-between border-t border-border pt-2">
        <Text variant="bodyStrong">{totalLabel}</Text>
        <Text variant="title" tone="primary" accessibilityLabel={`${totalLabel} ${formatMoney(b.totalAmount)}`}>
          {formatMoney(b.totalAmount)}
        </Text>
      </View>
    </View>
  );
}
