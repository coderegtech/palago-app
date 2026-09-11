/**
 * PalaGo design tokens.
 *
 * NativeWind classes are the primary styling mechanism. This file exists for
 * the places that need raw values instead of class names: react-navigation
 * themes, StatusBar, SVG props, map styling, and any imperative animation.
 *
 * These values mirror `tailwind.config.js` — change both together.
 */

import "@/global.css";

import { Platform } from "react-native";

export const Colors = {
  primary: "#087443",
  primaryDark: "#055C35",
  primaryLight: "#0F9459",
  primarySoft: "#E6F2EC",
  /** Deepest green in the brand mark — gradient ends and dark headers. */
  primaryDeep: "#08512B",

  secondary: "#F5B800",
  secondaryDark: "#C99600",
  secondarySoft: "#FFF6DB",

  /** Tropical accents carried over from the brand illustration. */
  aqua: "#1FBEB4",
  aquaSoft: "#E2F7F5",
  sun: "#FFC820",

  background: "#F7FAF7",
  /** Minted section background, for banding content areas apart. */
  backgroundTint: "#EAF4EE",
  surface: "#FFFFFF",

  text: "#12352A",
  textMuted: "#6B7F76",
  textInverse: "#FFFFFF",

  border: "#E2EAE5",
  borderStrong: "#C9D6CF",

  success: "#16A34A",
  successSoft: "#E7F6ED",
  warning: "#F59E0B",
  warningSoft: "#FEF3E2",
  danger: "#DC2626",
  dangerSoft: "#FDECEC",
  info: "#0284C7",
  infoSoft: "#E4F2FB",
} as const;

export type ColorToken = keyof typeof Colors;

/**
 * Brand gradients, as `expo-linear-gradient` colour stops.
 *
 * Used sparingly — headers and the brand hero only. The visual identity is
 * flat surfaces with a green frame, not gradients everywhere.
 */
export const Gradients = {
  /** Deep green header, top-left to bottom-right. */
  brand: ["#0E7A42", "#08512B"] as const,
  /** Sunset wash for the auth hero. */
  sunset: ["#0E7A42", "#129050", "#F5B800"] as const,
} as const;

/** 4pt spacing scale. */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  card: 16,
  sheet: 48,
  pill: 999,
} as const;

/**
 * Minimum height/width for anything tappable. Below this, touch accuracy drops
 * sharply — see the accessibility requirements in docs/architecture.md.
 */
export const MIN_TOUCH_TARGET = 44;

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

/** Widest the content column grows on tablet/web before it starts to centre. */
export const MaxContentWidth = 720;

/**
 * The same, for the admin console.
 *
 * Wider because a dashboard is scanned in columns rather than read in a line:
 * 720 is a comfortable measure for a booking flow on a phone and leaves a
 * desktop dashboard stranded in the middle of the screen beside its sidebar.
 */
export const AdminContentMaxWidth = 1280;

/**
 * Colour slice of the react-navigation theme. Merged over `DefaultTheme` in the
 * root layout so the navigator's own font descriptors stay untouched.
 */
export const NavigationColors = {
  primary: Colors.primary,
  background: Colors.background,
  card: Colors.surface,
  text: Colors.text,
  border: Colors.border,
  notification: Colors.danger,
} as const;
