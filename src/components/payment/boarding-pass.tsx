import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Badge } from '@/components/ui/badge';
import { Divider } from '@/components/ui/divider';
import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';

export interface BoardingPassProps {
  /** The JSON payload to encode. Built by `qrService.toQRString`. */
  value: string;
  reference: string;
  passengerNames: string[];
  seatNumbers: string[];
  operatorName: string;
  originCode: string;
  destinationCode: string;
  /** Set once the passenger has boarded, so a used pass is obviously used. */
  boardedAt?: string | null;
  className?: string;
}

/**
 * The boarding pass.
 *
 * This is the passenger's actual ticket, and a different QR from the payment
 * one — it exists only after payment is confirmed. The code itself carries just
 * a booking id, its reference and a signed token; the names and seats printed
 * around it come from the app's own data, not from the QR.
 */
export function BoardingPass({
  value,
  reference,
  passengerNames,
  seatNumbers,
  operatorName,
  originCode,
  destinationCode,
  boardedAt,
  className,
}: BoardingPassProps) {
  const used = Boolean(boardedAt);

  return (
    <View
      className={cn('items-center gap-3 rounded-card border border-border bg-surface p-4', className)}>
      <View className="items-center gap-1">
        <Text variant="label" tone="primary">
          Boarding pass
        </Text>
        <Text variant="mono" className="text-[13px]">
          {reference}
        </Text>
      </View>

      {/* A boarded pass is dimmed and labelled, so nobody presents it twice
          expecting it to work. */}
      <View className={cn('rounded-md bg-white p-2', used && 'opacity-30')}>
        <QRCode
          value={value}
          size={200}
          color={Colors.text}
          backgroundColor="#FFFFFF"
          ecl="M"
        />
      </View>

      {used ? (
        <Badge label="Already boarded" tone="neutral" />
      ) : (
        <Text variant="caption" tone="muted" className="text-center">
          Show this to the operator when boarding
        </Text>
      )}

      <Divider />

      <View className="w-full gap-1">
        <View className="flex-row justify-between">
          <Text variant="caption" tone="muted">
            Operator
          </Text>
          <Text variant="caption" className="font-semibold">
            {operatorName}
          </Text>
        </View>
        <View className="flex-row justify-between">
          <Text variant="caption" tone="muted">
            Route
          </Text>
          <Text variant="caption" className="font-semibold">
            {originCode} → {destinationCode}
          </Text>
        </View>
        <View className="flex-row justify-between">
          <Text variant="caption" tone="muted">
            Passenger{passengerNames.length === 1 ? '' : 's'}
          </Text>
          <Text variant="caption" className="flex-1 text-right font-semibold">
            {passengerNames.join(', ')}
          </Text>
        </View>
        <View className="flex-row justify-between">
          <Text variant="caption" tone="muted">
            Seat{seatNumbers.length === 1 ? '' : 's'}
          </Text>
          <Text variant="caption" className="font-semibold">
            {seatNumbers.join(', ')}
          </Text>
        </View>
      </View>
    </View>
  );
}
