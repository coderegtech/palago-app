import { Image } from "expo-image";

/**
 * The PalaGo badge — palm, sunset, coach and road.
 *
 * Rendered from the brand raster art (`assets/images/icon.png`, the same
 * source Expo rasterises the app icon and splash screen from) rather than a
 * hand-drawn recreation, so the in-app mark matches the shipped icons
 * exactly. See docs/brand.md.
 */
export function PalaGoMark({ size = 40 }: { size?: number }) {
  return (
    <Image
      source={require("@/assets/images/icon.png")}
      style={{ width: size, height: size }}
      contentFit="contain"
      accessibilityLabel="PalaGo"
    />
  );
}
