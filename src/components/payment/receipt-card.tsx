import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Text } from '@/components/ui/text';
import type { Centavos } from '@/types/models';
import { formatDate, formatTime } from '@/utils/datetime';
import { formatMoney } from '@/utils/money';

export interface ReceiptCardProps {
  receiptNumber: string;
  bookingReference: string;
  operatorName: string;
  originName: string;
  destinationName: string;
  departureDate: string;
  departureTime?: string;
  passengerNames: string[];
  seatNumbers: string[];
  subtotal: Centavos;
  discount: Centavos;
  loyaltyDiscount: Centavos;
  total: Centavos;
  paymentMethod: string;
  issuedAt: string;
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : 'caption'} className="flex-1 text-right">
        {value}
      </Text>
    </View>
  );
}

/**
 * The payment receipt.
 *
 * The test-mode banner was removed on request. Note that the mock-payment
 * guards remain in force underneath: `payments.provider` is constrained to
 * MOCK and `src/lib/env.ts` refuses any other provider, so this document still
 * records a simulated transaction — it simply no longer says so.
 */
export function ReceiptCard(props: ReceiptCardProps) {
  return (
    <Card className="gap-3">
      <View className="items-center gap-0.5">
        <Text variant="label" tone="primary">
          PalaGo
        </Text>
        <Text variant="subtitle">Payment Receipt</Text>
        <Text variant="mono" className="text-[13px]">
          {props.receiptNumber}
        </Text>
      </View>

      <Divider />

      <View className="gap-2">
        <Line label="Booking reference" value={props.bookingReference} strong />
        <Line label="Passenger" value={props.passengerNames.join(', ')} />
        <Line label="Operator" value={props.operatorName} />
        <Line
          label="Route"
          value={`${props.originName} → ${props.destinationName}`}
        />
        <Line
          label="Travel date"
          value={
            props.departureTime
              ? `${formatDate(props.departureDate)} · ${formatTime(props.departureTime)}`
              : formatDate(props.departureDate)
          }
        />
        <Line label="Seats" value={props.seatNumbers.join(', ')} />
      </View>

      <Divider />

      <View className="gap-2">
        <Line label="Subtotal" value={formatMoney(props.subtotal)} />
        {props.discount > 0 ? (
          <Line label="Discount" value={`−${formatMoney(props.discount)}`} />
        ) : null}
        {props.loyaltyDiscount > 0 ? (
          <Line label="Loyalty discount" value={`−${formatMoney(props.loyaltyDiscount)}`} />
        ) : null}
      </View>

      <View className="flex-row items-end justify-between border-t border-border pt-2">
        <Text variant="bodyStrong">TOTAL</Text>
        <Text variant="title" tone="primary">
          {formatMoney(props.total)}
        </Text>
      </View>

      <Divider />

      <View className="gap-2">
        <Line label="Payment method" value={props.paymentMethod} />
        <Line label="Payment status" value="PAID" strong />
        <Line label="Date" value={formatDate(props.issuedAt.slice(0, 10))} />
      </View>
    </Card>
  );
}
