import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { BrandHero } from '@/components/common/brand-hero';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Divider } from '@/components/ui/divider';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { TEST_PAYMENT_WARNING } from '@/constants/config';

/**
 * PalaGo test payment page — the target of the payment QR.
 *
 * This route is public by design: it renders in a stranger's phone browser with
 * no PalaGo session. That is why the root layout carries no auth gate and no
 * native permissions, and why this screen must never import camera, location or
 * notification modules.
 *
 * Phase 5 fills this in: fetch the safe payment summary through the `get-payment`
 * Edge Function using the reference, render the booking details, and confirm
 * through `confirm-test-payment`. Confirmation is a server operation — this page
 * will never write payment or booking status itself.
 */
export default function PaymentPage() {
  const { reference } = useLocalSearchParams<{ reference: string }>();

  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
      <BrandHero title="Payment Confirmation" size="md" withTagline={false} />

      <View className="pt-6" />

      <Alert
        tone="warning"
        title="TEST PAYMENT"
        message={TEST_PAYMENT_WARNING}
        className="mb-4"
      />

      <Card>
        <Text variant="caption" tone="muted" className="font-semibold uppercase">
          Payment reference
        </Text>
        <Text variant="mono" className="mt-1">
          {reference}
        </Text>

        <Divider className="my-4" />

        <View className="items-center gap-3 py-4">
          <Badge label="Not implemented · Phase 5" tone="warning" />
          <Text variant="body" tone="muted" className="text-center">
            Booking summary, amount and the confirm action are added in Phase 5, once payments
            exist in the database.
          </Text>
        </View>
      </Card>

      <Button
        label="Confirm test payment"
        disabled
        className="mt-6"
        accessibilityHint="Not available yet — payment confirmation is implemented in Phase 5."
      />

      <Text variant="caption" tone="muted" className="mt-4 text-center">
        PalaGo processes no real money. No card, bank, GCash or Maya transaction takes place.
      </Text>
    </Screen>
  );
}
