/**
 * Can this browser scan a boarding pass with a camera — and if not, why not?
 *
 * expo-camera scans on web (it uses the browser's BarcodeDetector, or a
 * WebAssembly decoder where that is missing), but its permission API cannot be
 * trusted to explain a failure. Every getUserMedia error that is not a
 * dismissed prompt comes back as DENIED, so all three of these look identical
 * to it — and to an operator staring at an "Allow camera" button that does
 * nothing:
 *
 *   * the page is served over plain HTTP from a LAN address, where browsers
 *     remove `navigator.mediaDevices` entirely;
 *   * the browser has no camera API at all;
 *   * the machine simply has no camera — a desktop at a ticket counter.
 *
 * Each needs a different fix, so each is detected here, before the permission
 * prompt, and named. `assessWebCamera` is pure and takes its inputs as an
 * argument, the same way `parseEnv` does, so the decision is unit-testable
 * without a browser.
 */

import { Platform } from 'react-native';

export type WebCameraBlocker = 'insecure-context' | 'unsupported' | 'no-camera';

export type WebCameraSupport = { ok: true } | { ok: false; reason: WebCameraBlocker };

export interface CameraEnvironment {
  /** `window.isSecureContext`: true on HTTPS and on localhost. */
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  /** Number of `videoinput` devices, or null when they could not be listed. */
  videoInputCount: number | null;
}

export function assessWebCamera(env: CameraEnvironment): WebCameraSupport {
  // Checked first, and on purpose: an insecure page has no mediaDevices, so it
  // would otherwise be reported as "unsupported" — hiding the one cause that is
  // fixable by the person reading the message.
  if (!env.isSecureContext) return { ok: false, reason: 'insecure-context' };
  if (!env.hasGetUserMedia) return { ok: false, reason: 'unsupported' };
  // Browsers expose one entry per kind of device that exists even before the
  // camera is granted, so zero really means none. Null means the list could not
  // be read at all; that is not evidence of anything, so let the browser try.
  if (env.videoInputCount === 0) return { ok: false, reason: 'no-camera' };
  return { ok: true };
}

export async function readCameraEnvironment(): Promise<CameraEnvironment> {
  const isSecureContext = typeof window !== 'undefined' && window.isSecureContext === true;
  const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const hasGetUserMedia = typeof devices?.getUserMedia === 'function';

  let videoInputCount: number | null = null;
  if (typeof devices?.enumerateDevices === 'function') {
    try {
      const list = await devices.enumerateDevices();
      videoInputCount = list.filter((d) => d.kind === 'videoinput').length;
    } catch {
      videoInputCount = null;
    }
  }

  return { isSecureContext, hasGetUserMedia, videoInputCount };
}

/** Always `ok` on native, where the permission flow already tells the truth. */
export async function checkWebCamera(): Promise<WebCameraSupport> {
  if (Platform.OS !== 'web') return { ok: true };
  return assessWebCamera(await readCameraEnvironment());
}

/** What an operator is told, per cause. Plain words; they are at a door. */
export const WEB_CAMERA_BLOCKER_COPY: Record<WebCameraBlocker, { title: string; message: string }> =
  {
    'insecure-context': {
      title: 'Camera needs a secure connection',
      message:
        'Browsers only allow the camera on HTTPS pages. Open PalaGo from its https:// address, or enter the pass below.',
    },
    unsupported: {
      title: 'This browser cannot use a camera',
      message: 'Try a current version of Chrome, Edge, Safari or Firefox, or enter the pass below.',
    },
    'no-camera': {
      title: 'No camera found',
      message:
        'This device has no camera PalaGo can use. Connect one and reload, or enter the pass below.',
    },
  };

/**
 * A browser remembers a blocked camera per site and will not prompt again, so
 * a second "Allow" press silently fails. The only way back is the browser's own
 * site settings.
 *
 * The message also names the other cause, because expo-camera cannot tell them
 * apart: a camera already held by a video-call app fails getUserMedia too, and
 * comes back as the same DENIED.
 */
export const WEB_CAMERA_BLOCKED_COPY = {
  title: 'Camera not available',
  message:
    'Your browser may be blocking the camera for PalaGo — allow it from the camera icon in the address bar or in site settings, then reload. If another app or tab is using the camera, close it first.',
};
