import { useCallback, useRef } from 'react';

/** What react-native-svg's root element exposes. Typed `any` by the QR library. */
interface SvgWithDataUrl {
  toDataURL: (callback: (base64: string) => void) => void;
}

/**
 * A ref for a react-native-qrcode-svg `getRef`, and a function that reads the
 * rendered code back as base64 PNG — what the native share sheet saves. Web
 * does not use it: it draws its own image with the details around the code.
 */
export function useQrPng() {
  const ref = useRef<SvgWithDataUrl | null>(null);

  const getRef = useCallback((svg: unknown) => {
    ref.current = svg && typeof (svg as SvgWithDataUrl).toDataURL === 'function'
      ? (svg as SvgWithDataUrl)
      : null;
  }, []);

  const getPngBase64 = useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        const svg = ref.current;
        if (!svg) {
          reject(new Error('The QR code is not on screen yet.'));
          return;
        }
        svg.toDataURL((base64) => resolve(base64));
      }),
    [],
  );

  return { getRef, getPngBase64 };
}
