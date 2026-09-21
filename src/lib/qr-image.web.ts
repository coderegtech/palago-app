/**
 * Save a QR code as a PNG — web.
 *
 * Draws the code with the `qrcode` library onto a canvas together with a title
 * and a few lines of text (the reference, the trip, the passengers), so the
 * saved image means something on its own when it is forwarded to the person
 * who will actually travel. Then downloads it.
 *
 * The native build uses `qr-image.ts`, which shares the image instead.
 */

import QRCode from 'qrcode';

import { safeFilename, type SaveQrImageInput } from './qr-image-shared';

export type { SaveQrImageInput } from './qr-image-shared';

const WIDTH = 640;
const PAD = 40;
const QR = WIDTH - PAD * 2;

export async function saveQrImage(input: SaveQrImageInput): Promise<void> {
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, input.value, {
    width: QR,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#0F2A1D', light: '#FFFFFF' },
  });

  const titleHeight = 56;
  const lineHeight = 30;
  const height = PAD + titleHeight + QR + 16 + input.lines.length * lineHeight + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the image.');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, WIDTH, height);

  ctx.fillStyle = '#0B6B3A';
  ctx.font = 'bold 28px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(input.title, WIDTH / 2, PAD + 32);

  ctx.drawImage(qr, PAD, PAD + titleHeight);

  ctx.fillStyle = '#0F2A1D';
  ctx.font = '20px system-ui, -apple-system, Segoe UI, sans-serif';
  input.lines.forEach((line, i) => {
    ctx.fillText(line, WIDTH / 2, PAD + titleHeight + QR + 16 + (i + 1) * lineHeight - 8, WIDTH - PAD * 2);
  });

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png'),
  );

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFilename(input.filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Long enough for the browser to have started the download.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
