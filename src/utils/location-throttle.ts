/**
 * Whether a GPS fix should be published, given when the last one was sent.
 *
 * `watchPositionAsync`'s `timeInterval` is honoured on Android only. iOS
 * ignores it and reports a fix every `distanceInterval` metres — every 25 m,
 * which at highway speed is more than one `bus_locations` insert a second, each
 * fanned out over Realtime to every passenger watching. So the publisher does
 * its own throttling rather than trusting the platform to.
 *
 * The time is the moment of the last *attempt*, not the last success: a failed
 * publish is retried by the next fix after the interval, never by a burst.
 */
export function shouldPublishFix(
  lastAttemptAt: number | null,
  now: number,
  minIntervalMs: number,
): boolean {
  if (lastAttemptAt === null) return true;
  // A clock that moved backwards (manual change, NTP correction) must not
  // silence the bus until it catches up again.
  if (now < lastAttemptAt) return true;
  return now - lastAttemptAt >= minIntervalMs;
}
