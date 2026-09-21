export interface SaveQrImageInput {
  /** What the QR encodes. */
  value: string;
  /** Suggested file name; sanitised, and `.png` is added. */
  filename: string;
  /** Printed above the code on the saved image (web). */
  title: string;
  /** Printed under the code: reference, trip, passengers (web). */
  lines: string[];
  /**
   * Native only: the rendered code as base64 PNG, from the on-screen QR's
   * `toDataURL`. Web draws its own, with the text around it.
   */
  getPngBase64?: () => Promise<string>;
}

/** A file name that is safe on every platform, always ending in `.png`. */
export function safeFilename(name: string): string {
  const base = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'qr-code';
  return base.toLowerCase().endsWith('.png') ? base : `${base}.png`;
}
