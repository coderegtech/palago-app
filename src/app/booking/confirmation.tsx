import { PlaceholderScreen } from '@/components/common/placeholder-screen';

export default function ConfirmationScreen() {
  return (
    <PlaceholderScreen
      title="Booking confirmed"
      phase="Phase 5"
      description="Receipt summary and the boarding QR, generated only after payment is confirmed server-side."
      showBack
    />
  );
}
