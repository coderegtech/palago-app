import { TripStatus } from '@/constants/enums';
import { compareDriverTrips, orderDriverTrips, tripStatusRank } from '@/utils/trip-order';

const trip = (status: TripStatus | string, departureDate: string, departureTime = '08:00') => ({
  status,
  departureDate,
  departureTime,
});

describe('tripStatusRank', () => {
  it('puts the trip being driven first', () => {
    expect(tripStatusRank(TripStatus.ON_TRIP)).toBeLessThan(tripStatusRank(TripStatus.BOARDING));
    expect(tripStatusRank(TripStatus.DEPARTED)).toBe(tripStatusRank(TripStatus.ON_TRIP));
  });

  it('ranks boarding above merely scheduled', () => {
    expect(tripStatusRank(TripStatus.BOARDING)).toBeLessThan(tripStatusRank(TripStatus.SCHEDULED));
  });

  it('ranks arrived above completed', () => {
    // An arrived trip still needs ending. Ranking it with the finished ones
    // would bury the one thing on the list that needs the driver to act.
    expect(tripStatusRank(TripStatus.ARRIVED)).toBeLessThan(tripStatusRank(TripStatus.COMPLETED));
  });

  it('sinks cancelled to the bottom', () => {
    const others = [
      TripStatus.ON_TRIP,
      TripStatus.BOARDING,
      TripStatus.SCHEDULED,
      TripStatus.ARRIVED,
      TripStatus.COMPLETED,
    ];
    for (const status of others) {
      expect(tripStatusRank(TripStatus.CANCELLED)).toBeGreaterThan(tripStatusRank(status));
    }
  });

  it('shows an unrecognised status rather than hiding it', () => {
    // A status the app does not know about must not fall off the bottom of a
    // driver's roster; it sorts with the upcoming ones where it will be seen.
    expect(tripStatusRank('SOMETHING_NEW')).toBe(tripStatusRank(TripStatus.SCHEDULED));
  });
});

describe('compareDriverTrips', () => {
  it('puts what is happening now above what is merely sooner', () => {
    const running = trip(TripStatus.ON_TRIP, '2026-09-20');
    const earlierButScheduled = trip(TripStatus.SCHEDULED, '2026-09-18');

    expect(compareDriverTrips(running, earlierButScheduled)).toBeLessThan(0);
  });

  it('reads upcoming trips soonest first', () => {
    const soon = trip(TripStatus.SCHEDULED, '2026-09-18');
    const later = trip(TripStatus.SCHEDULED, '2026-09-25');

    expect(compareDriverTrips(soon, later)).toBeLessThan(0);
  });

  it('reads finished trips most recent first', () => {
    // The opposite direction on purpose: the run you might need to look back at
    // is last night's, not the one from a fortnight ago.
    const lastNight = trip(TripStatus.COMPLETED, '2026-09-15');
    const aFortnightAgo = trip(TripStatus.COMPLETED, '2026-09-01');

    expect(compareDriverTrips(lastNight, aFortnightAgo)).toBeLessThan(0);
  });

  it('breaks a same-day tie by departure time', () => {
    const morning = trip(TripStatus.SCHEDULED, '2026-09-20', '06:00');
    const afternoon = trip(TripStatus.SCHEDULED, '2026-09-20', '14:00');

    expect(compareDriverTrips(morning, afternoon)).toBeLessThan(0);
  });
});

describe('orderDriverTrips', () => {
  it('reads the way a driver reads their day', () => {
    const roster = [
      trip(TripStatus.COMPLETED, '2026-09-01'),
      trip(TripStatus.SCHEDULED, '2026-09-25'),
      trip(TripStatus.CANCELLED, '2026-09-19'),
      trip(TripStatus.ON_TRIP, '2026-09-16'),
      trip(TripStatus.SCHEDULED, '2026-09-18'),
      trip(TripStatus.ARRIVED, '2026-09-15'),
      trip(TripStatus.COMPLETED, '2026-09-14'),
      trip(TripStatus.BOARDING, '2026-09-16', '17:00'),
    ];

    expect(orderDriverTrips(roster).map((t) => `${t.status} ${t.departureDate}`)).toEqual([
      'ON_TRIP 2026-09-16',
      'BOARDING 2026-09-16',
      'SCHEDULED 2026-09-18',
      'SCHEDULED 2026-09-25',
      'ARRIVED 2026-09-15',
      'COMPLETED 2026-09-14',
      'COMPLETED 2026-09-01',
      'CANCELLED 2026-09-19',
    ]);
  });

  it('does not mutate what it was given', () => {
    const roster = [trip(TripStatus.COMPLETED, '2026-09-01'), trip(TripStatus.ON_TRIP, '2026-09-16')];
    const before = roster.map((t) => t.status);

    orderDriverTrips(roster);

    expect(roster.map((t) => t.status)).toEqual(before);
  });

  it('handles an empty roster', () => {
    expect(orderDriverTrips([])).toEqual([]);
  });
});
