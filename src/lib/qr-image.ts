/**
 * Save a QR code as a PNG — iOS and Android.
 *
 * Writes the on-screen code (from react-native-qrcode-svg's `toDataURL`) to the
 * app's cache and opens the system share sheet. From there the passenger saves
 * it to Photos, or sends it straight to the person who will travel — the
 * "Person A booked for Person B" case — over Messenger, Viber or SMS. Sharing
 * rather than writing to the gallery also needs no photo-library permission.
 *
 * Web uses `qr-image.web.ts`, which downloads a composed image instead.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { ErrorCode } from '@/constants/errors';
import { AppError } from '@/lib/errors';

import { safeFilename, type SaveQrImageInput } from './qr-image-shared';

export type { SaveQrImageInput } from './qr-image-shared';

export async function saveQrImage(input: SaveQrImageInput): Promise<void> {
  if (!input.getPngBase64) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'The QR code is not ready yet. Try again.');
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Saving images is not available on this device.');
  }

  const base64 = await input.getPngBase64();
  const file = new File(Paths.cache, safeFilename(input.filename));
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });

  await Sharing.shareAsync(file.uri, {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: input.title,
  });
}
