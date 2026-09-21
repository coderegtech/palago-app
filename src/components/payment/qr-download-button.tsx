/**
 * "Download QR code" — saves the code on screen as an image.
 *
 * On web it downloads a PNG with the title and details printed around the code;
 * on a phone it opens the share sheet, so the image can be saved to Photos or
 * sent to the person who is actually travelling. See `@/lib/qr-image`.
 */

import { Download } from 'lucide-react-native';
import { useState } from 'react';
import { Platform } from 'react-native';

import { Button } from '@/components/ui/button';
import { Colors } from '@/constants/theme';
import { AppError } from '@/lib/errors';
import { saveQrImage, type SaveQrImageInput } from '@/lib/qr-image';
import { useUIStore } from '@/stores/ui-store';

export interface QrDownloadButtonProps extends SaveQrImageInput {
  label?: string;
}

export function QrDownloadButton({ label = 'Download QR code', ...input }: QrDownloadButtonProps) {
  const [busy, setBusy] = useState(false);
  const showToast = useUIStore((state) => state.showToast);

  async function save() {
    setBusy(true);
    try {
      await saveQrImage(input);
      if (Platform.OS === 'web') {
        showToast({ tone: 'success', title: 'QR code downloaded' });
      }
    } catch (error) {
      showToast({
        tone: 'danger',
        title: 'Could not save the QR code',
        message: error instanceof AppError ? error.message : 'Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      label={label}
      variant="outline"
      size="sm"
      fullWidth={false}
      loading={busy}
      icon={<Download size={16} color={Colors.primary} />}
      onPress={() => void save()}
      accessibilityLabel={`${label}. ${input.title}.`}
    />
  );
}
