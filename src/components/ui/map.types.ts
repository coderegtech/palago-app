/**
 * Shared map contract.
 *
 * Kept separate from the implementations so `map.tsx` (native, MapLibre) and
 * `map.web.tsx` (fallback) cannot drift apart, and so screens can import the
 * types without pulling in a native module.
 */

/** `[longitude, latitude]` — MapLibre's order, and GeoJSON's. Not lat/lng. */
export type LngLat = [number, number];

export interface MapMarker {
  id: string;
  coordinate: LngLat;
  /**
   * Rendered inside the marker; falls back to a PalaGo pin when omitted.
   * MapLibre requires exactly one element here, not arbitrary nodes.
   */
  children?: React.ReactElement;
}

export interface MapProps {
  center: LngLat;
  /** MapLibre zoom level. ~6 shows Palawan; ~13 a town; ~16 a street. */
  zoom?: number;
  markers?: MapMarker[];
  /** Route or travelled path, drawn as a line. */
  polyline?: LngLat[];
  /** Show the device's own position. Requires location permission. */
  showUserLocation?: boolean;
  /** Keep the camera on `center` as it changes, e.g. a moving bus. */
  followCenter?: boolean;
  className?: string;
}
