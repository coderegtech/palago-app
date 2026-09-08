# Realtime

## Status: not yet implemented

Payment/booking status subscriptions arrive in Phase 5; trip tracking in Phase 8; notifications in
Phase 12.

## Where Realtime is used

| Channel | Publisher | Subscriber | Why |
|---|---|---|---|
| Payment + booking status | `confirm-test-payment` | the passenger's app | The confirmation happens on a *different device* — the phone that scanned the QR. Polling would make the app feel broken. |
| Bus location | driver app | passengers on that trip, and the operator | Live tracking. |
| Notifications | server | the recipient | In-app feed updates without a refresh. |
| Seat availability | `reserve_seats` | passengers viewing that seat map | Avoids selecting a seat someone else just took. |

## Rules

- **Subscribe, do not poll.** Repeated queries on a mobile network burn battery and data. The one
  place a poll is acceptable is a bounded fallback when a subscription fails to establish.
- **Subscriptions are scoped by RLS.** A passenger receives location for a trip only while holding a
  confirmed booking on it; an operator only for their own trips. Realtime authorisation is not a
  client-side filter.
- **Unsubscribe on unmount.** Every subscription is torn down when its screen goes away; leaked
  channels are the usual cause of "the app gets slower the longer you use it".
- **Disconnects are expected.** Reconnect with backoff, and on reconnect refetch the underlying
  query rather than assuming no events were missed.

## Driver location

`expo-location` publishes to `bus_locations` every 10 seconds
(`LOCATION_UPDATE_INTERVAL_MS`), adjustable for battery and network conditions. A driver may write
only for the trip assigned to them — enforced by RLS, not by the app.

Passenger-side states that must be handled: permission denied, location services off, no GPS fix,
and stale data (last known position with its timestamp, rather than a silently frozen marker).

## Maps — MapLibre

Rendering is **MapLibre**, via `@maplibre/maplibre-react-native`. Three consequences worth knowing
before Phase 8:

1. **It is a native module.** It does not run in Expo Go. Anything importing the map needs a
   development build:

   ```bash
   npx expo run:android
   ```

2. **There is no react-native-web build.** `src/components/ui/map.tsx` is native-only and
   `map.web.tsx` is a graceful placeholder. This split is not cosmetic: pulling MapLibre into the
   web bundle would break every web route, including the public `/payment/[reference]` page that has
   to load in a stranger's browser. Both implementations share `map.types.ts` so they cannot drift.

3. **Tiles are configurable.** `EXPO_PUBLIC_MAP_STYLE_URL` points at a MapLibre style JSON,
   defaulting to OpenFreeMap, which needs no API key. Production should move to MapTiler or a
   self-hosted style. Attribution stays enabled — OpenStreetMap-derived tiles require it.

### The `Map` primitive

```tsx
<Map
  center={[118.7353, 9.7392]}   // [lng, lat] — MapLibre order, not lat/lng
  zoom={13}
  markers={[{ id: 'bus-1', coordinate: [118.74, 9.74] }]}
  polyline={routeCoordinates}
  followCenter                   // animate the camera as the bus moves
/>
```

`followCenter` drives the camera from `center` so it eases to each new position; without it the
camera only sets the opening view and then belongs to the user.

**Status: the component is written and typechecks against the MapLibre v11 API, but has not been
run on a device** — that requires a development build, which Phase 8 does. Treat the first Phase 8
task as building and confirming it on hardware before layering tracking on top.
