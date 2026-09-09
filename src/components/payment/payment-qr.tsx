import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Text } from '@/components/ui/text';
import { Colors } from '@/constants/theme';
import { cn } from '@/utils/cn';

export interface PaymentQRProps {
  /** The payment URL. Encoded verbatim so any camera app can open it. */
  value: string;
  size?: number;
  className?: string;
}

/**
 * The payment QR.
 *
 * This is **not a ticket**. It encodes a link to the PalaGo test payment page
 * and nothing else — no passenger data, no payment details. The boarding pass
 * is a separate QR, issued only after payment is confirmed (Phase 6). Conflating
 * the two would let an unpaid booking board.
 *
 * A plain URL rather than a custom scheme, so the phone's own camera opens it
 * without PalaGo installed — which is the point, since the payer may be using
 * someone else's phone.
 */
export function PaymentQR({ value, size = 220, className }: PaymentQRProps) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Payment QR code. Scan it with a phone camera to open the test payment page."
      className={cn('items-center gap-3 rounded-card bg-surface p-4', className)}>
      <QRCode
        value={value}
        size={size}
        color={Colors.text}
        backgroundColor={Colors.surface}
        // Medium error correction: still scannable off a slightly dirty or
        // angled screen without making the pattern needlessly dense.
        ecl="M"
      />
      <Text variant="caption" tone="muted" className="text-center">
        Scan with any phone camera
      </Text>
    </View>
  );
}
