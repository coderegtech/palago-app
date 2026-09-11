/**
 * Viewport width, for the few places that must render a genuinely different
 * structure rather than restyle the same one.
 *
 * `useWindowDimensions` re-renders on rotation and on browser resize, so this
 * tracks a dragged window rather than only the width at mount.
 *
 * Prefer flex-wrap and `min-w-[…]` in classes where a layout can simply reflow;
 * reach for this only when the tree itself changes — the admin console swapping
 * a sidebar for a bottom bar is the case it exists for.
 */

import { useWindowDimensions } from 'react-native';

/** Tailwind's `md`. Below this a phone, at or above it a usable sidebar. */
export const DESKTOP_MIN_WIDTH = 768;

/** Tailwind's `lg`. Enough room for the sidebar to carry labels comfortably. */
export const WIDE_MIN_WIDTH = 1024;

export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return width >= DESKTOP_MIN_WIDTH;
}

export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= WIDE_MIN_WIDTH;
}
