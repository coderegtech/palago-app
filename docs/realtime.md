# Realtime

## Status

Payment and booking status subscriptions (Phase 5) and trip tracking (Phase 8) are implemented.
Notifications arrive in Phase 12; seat-availability subscriptions are not built.

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

`expo-location` publishes to `bus_locations` every 10 seconds (`LOCATION_UPDATE_INTERVAL_MS`) and
at least 25 metres apart (`LOCATION_DISTANCE_INTERVAL_M`) — a bus queueing at a terminal should not
spend battery re-sending the same coordinate. A driver may write only for a trip assigned to them,
on an ACTIVE assignment, while the trip is BOARDING, DEPARTED or ON_TRIP — enforced by RLS, not by
the app, and proved by `pnpm db:verify:tracking`.

**The insert is a direct table write, not an Edge Function.** It is the one privileged-looking
operation in PalaGo that is not, because there is no secret to hold and no cross-row invariant to
maintain — only "is this caller the assigned driver", which is exactly what a policy expresses.
Trip *status* is a different matter and goes through `start_trip` / `set_trip_boarding` /
`end_trip`, which are SECURITY DEFINER.

`driver_id` is defaulted from `current_driver_id()`, so the client never names a driver.

**The trail is append-only.** No client may UPDATE or DELETE `bus_locations` — not the driver who
wrote a row, not the operator who owns the bus. A trail that can be rewritten is not evidence of
when a bus actually left, and `trips.actual_departure_at` is what the operator's on-time figure is
computed from.

**Foreground only.** `isAndroidBackgroundLocationEnabled` is false: publishing runs while the trip
screen is open and stops when the app closes. Background location needs its own Play Store
declaration and would mean tracking a driver between trips.

States that must be handled, and are, each with its own wording: permission denied, location
services off, no GPS fix yet, patchy connection (some pings lost), repeated publish failures, and a
stale last-known position shown with its age rather than as a silently frozen marker.
`LOCATION_STALE_AFTER_MS` is six intervals — long enough to ride out a tunnel, short enough not to
mislead.

## No estimated arrival

PalaGo does not predict arrival times. Straight-line distance over an average speed is wrong on the
Puerto Princesa–El Nido road, and a passenger who misses a connection because the app guessed is
worse off than one who was told nothing. The tracking screen shows the operator's scheduled arrival
and says why there is no estimate.

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

**Status: still not run on a device.** The component typechecks against the MapLibre v11 API and is
used by both the crew trip screen and the passenger tracking screen, but rendering it needs
`npx expo run:android`, which has not been done. Everything behind the map — the data, the
authorisation, the Realtime updates, the degraded states — is verified; the map itself is not.
