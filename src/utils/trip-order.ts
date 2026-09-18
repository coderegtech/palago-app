import { TripStatus } from '@/constants/enums';

/**
 * How urgent a trip is to the person driving it.
 *
 * A driver's roster is not a calendar. Sorted by departure time alone, the trip
 * they are *on right now* sits wherever this morning falls in the list, below
 * yesterday's completed runs once the day rolls over. What they need first is
 * the one that is moving, then the one about to, then the rest.
 *
 * Lower sorts first:
 *
 *   0  ON_TRIP, DEPARTED  — you are driving this now
 *   1  BOARDING           — passengers are getting on
 *   2  SCHEDULED          — still to come
 *   3  ARRIVED            — pulled in, not yet closed off
 *   4  COMPLETED          — done
 *   5  CANCELLED          — not happening
 *
 * ARRIVED ranks above COMPLETED deliberately: a trip that has arrived but not
 * been ended still needs the driver to do something, which is exactly the case
 * that would otherwise be buried under a week of finished runs.
 */
export function tripStatusRank(status: TripStatus | string): number {
  switch (status) {
    case TripStatus.ON_TRIP:
    case TripStatus.DEPARTED:
      return 0;
    case TripStatus.BOARDING:
      return 1;
    case TripStatus.SCHEDULED:
      return 2;
    case TripStatus.ARRIVED:
      return 3;
    case TripStatus.COMPLETED:
      return 4;
    case TripStatus.CANCELLED:
      return 5;
    default:
      // An unknown status sorts with the merely upcoming rather than vanishing
      // to the bottom — a driver should still see a trip the app cannot label.
      return 2;
  }
}

export interface OrderableTrip {
  status: TripStatus | string;
  departureDate: string;
  departureTime: string;
}

/**
 * Compares two trips the way a driver reads their roster: by what needs doing,
 * then by when.
 *
 * Within a rank the order flips with it. Anything still ahead — running,
 * boarding, scheduled — reads soonest first, because that is the next thing to
 * do. Anything finished — arrived, completed, cancelled — reads most recent
 * first, because that is the one you might need to look back at. Sorting the
 * whole list one way would bury either today's next departure or last night's
 * run, depending which way you picked.
 */
export function compareDriverTrips(a: OrderableTrip, b: OrderableTrip): number {
  const rank = tripStatusRank(a.status) - tripStatusRank(b.status);
  if (rank !== 0) return rank;

  const when = (t: OrderableTrip) => `${t.departureDate} ${t.departureTime}`;
  const chronological = when(a).localeCompare(when(b));

  return tripStatusRank(a.status) >= tripStatusRank(TripStatus.ARRIVED)
    ? -chronological
    : chronological;
}

/** `compareDriverTrips` applied, without mutating the caller's array. */
export function orderDriverTrips<T extends OrderableTrip>(trips: readonly T[]): T[] {
  return [...trips].sort(compareDriverTrips);
}
