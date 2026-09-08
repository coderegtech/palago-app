import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  Marker,
  UserLocation,
} from '@maplibre/maplibre-react-native';
import { View } from 'react-native';

import type { MapProps } from '@/components/ui/map.types';
import { Colors, Radius } from '@/constants/theme';
import { env } from '@/lib/env';
import { cn } from '@/utils/cn';

/**
 * Native map, backed by MapLibre.
 *
 * MapLibre is a native module: it does **not** run in Expo Go, and it does not
 * run under react-native-web — `map.web.tsx` covers the web build, which is how
 * the public payment page keeps loading without dragging a map engine in.
 * Anything using this component needs a development build:
 *
 *   npx expo run:android
 *
 * The tile style comes from `EXPO_PUBLIC_MAP_STYLE_URL`, so switching from the
 * free OpenFreeMap tiles to MapTiler or a self-hosted style is a config change.
 */
export function Map({
  center,
  zoom = 12,
  markers = [],
  polyline,
  showUserLocation = false,
  followCenter = false,
  className,
}: MapProps) {
  return (
    <View
      className={cn('overflow-hidden bg-background-tint', className)}
      style={{ borderRadius: Radius.card }}>
      {/* Attribution stays on — OpenFreeMap and OpenStreetMap require it. */}
      <MapLibreMap mapStyle={env.mapStyleUrl} style={{ flex: 1 }} attribution logo={false}>
        {followCenter ? (
          // Driving the camera from `center` lets it animate as the bus moves.
          <Camera center={center} zoom={zoom} duration={800} easing="ease" />
        ) : (
          // Uncontrolled: sets the opening view, then leaves panning to the user.
          <Camera initialViewState={{ center, zoom }} />
        )}

        {polyline && polyline.length > 1 ? (
          <GeoJSONSource
            id="palago-route"
            data={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: polyline },
            }}>
            <Layer
              id="palago-route-line"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': Colors.primary,
                'line-width': 4,
                'line-opacity': 0.9,
              }}
            />
          </GeoJSONSource>
        ) : null}

        {markers.map((marker) => (
          <Marker key={marker.id} id={marker.id} lngLat={marker.coordinate}>
            {marker.children ?? (
              <View
                className="h-4 w-4 rounded-full border-2 border-white bg-primary"
                accessibilityLabel="Map marker"
              />
            )}
          </Marker>
        ))}

        {showUserLocation ? <UserLocation /> : null}
      </MapLibreMap>
    </View>
  );
}
