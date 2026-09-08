import { View } from 'react-native';
import { Map as MapIcon } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import type { MapProps } from '@/components/ui/map.types';
import { Colors, Radius } from '@/constants/theme';
import { cn } from '@/utils/cn';

/**
 * Web stand-in for the native MapLibre map.
 *
 * `@maplibre/maplibre-react-native` is a native module with no
 * react-native-web build. Importing it into the web bundle would break every
 * web route — including the public `/payment/[reference]` page, which has to
 * load in a stranger's browser.
 *
 * Live tracking is a phone feature, so rather than pull in `maplibre-gl` and a
 * second rendering path for a surface nobody tracks a bus on, the web build
 * says plainly that the map is unavailable. If tracking on web is ever wanted,
 * this file is the single place to implement it with `maplibre-gl`.
 */
export function Map({ className }: MapProps) {
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Map view is available in the PalaGo mobile app"
      className={cn(
        'items-center justify-center gap-2 border border-border bg-background-tint p-6',
        className,
      )}
      style={{ borderRadius: Radius.card }}>
      <MapIcon size={28} color={Colors.textMuted} />
      <Text variant="bodyStrong" className="text-center">
        Live map is available in the app
      </Text>
      <Text variant="caption" tone="muted" className="text-center">
        Open PalaGo on your phone to follow the bus in real time.
      </Text>
    </View>
  );
}
