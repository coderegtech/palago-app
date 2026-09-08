import { PlaceholderScreen } from '@/components/common/placeholder-screen';

export default function PaymentQRScreen() {
  return (
    <PlaceholderScreen
      title="Scan to pay"
      phase="Phase 5"
      description="QR that opens the test payment page, with the booking status updating over Realtime."
      showBack
    />
  );
}
