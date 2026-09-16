/**
 * What trip search is allowed to offer.
 *
 * These tests exist because of a gap they would have caught. Migration
 * `20260915000032_bookable_trips.sql` added `is_active`, `operator_status`,
 * `route_status` and `bus_status` to the `trip_search` view specifically so the
 * client could stop offering trips the server will refuse to sell — and then
 * `searchTrips` never filtered on any of them. `create_booking` still refused
 * with INACTIVE_RESOURCE, so nothing wrong was ever sold; the passenger simply
 * picked a departure on a withdrawn coach, named their fellow travellers, and
 * was turned away at the payment step for a reason they were never shown.
 *
 * Confirmed against the running stack before it was fixed: with the bus set
 * INACTIVE, its trip was still returned by the exact query this service builds.
 *
 * The other half matters just as much and pulls the opposite way. `getTrip`
 * must NOT filter — somebody holding a ticket on a coach that has since been
 * withdrawn still has to be able to open it. A single "just filter everywhere"
 * fix would break the boarding pass of every passenger on a retired bus, which
 * is why both halves are asserted here rather than only the new one.
 */

import { BusType } from '@/constants/enums';
import { tripService } from '@/services/trip-service';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const from = supabase.from as unknown as jest.Mock;

/**
 * A stand-in for the PostgREST query builder.
 *
 * Every method returns the builder so the chain composes, except the two that
 * end it — `order` for a list and `single` for one row — which resolve. The
 * point is not to simulate PostgREST but to record what the service asked for,
 * because the filters *are* the behaviour under test: they run in the database,
 * so there is nothing else to observe.
 */
function builder(result: { data: unknown; error: unknown }) {
  const calls: [string, ...unknown[]][] = [];
  const self: Record<string, jest.Mock> = {};
  const chaining = ['select', 'eq', 'in', 'gte', 'lte', 'lt', 'limit', 'not'];
  const terminal = ['order', 'single', 'maybeSingle'];

  for (const name of chaining) {
    self[name] = jest.fn((...args: unknown[]) => {
      calls.push([name, ...args]);
      return self;
    });
  }
  for (const name of terminal) {
    self[name] = jest.fn((...args: unknown[]) => {
      calls.push([name, ...args]);
      return Promise.resolve(result);
    });
  }

  return Object.assign(self, {
    calls,
    /** Every `eq(column, value)` the service applied, as a plain map. */
    equalities: () =>
      Object.fromEntries(
        calls.filter(([name]) => name === 'eq').map(([, column, value]) => [column as string, value]),
      ),
  });
}

const SEARCH = {
  originTerminalId: 'origin-1',
  destinationTerminalId: 'destination-1',
  departureDate: '2026-10-01',
  passengers: 2,
};

beforeEach(() => jest.clearAllMocks());

describe('searchTrips', () => {
  it('offers only what the server would agree to sell', async () => {
    const query = builder({ data: [], error: null });
    from.mockReturnValue(query);

    await tripService.searchTrips(SEARCH);

    // All four, or the funnel offers a trip that dies at the payment step.
    expect(query.equalities()).toMatchObject({
      is_active: true,
      operator_status: 'ACTIVE',
      route_status: 'ACTIVE',
      bus_status: 'ACTIVE',
    });
  });

  it('reads the status columns it filters on', async () => {
    const query = builder({ data: [], error: null });
    from.mockReturnValue(query);

    await tripService.searchTrips(SEARCH);

    const columns = String(query.select.mock.calls[0][0]);
    for (const column of ['is_active', 'operator_status', 'route_status', 'bus_status']) {
      expect(columns).toContain(column);
    }
  });

  it('asks for the route, the date and enough seats for the whole party', async () => {
    const query = builder({ data: [], error: null });
    from.mockReturnValue(query);

    await tripService.searchTrips(SEARCH);

    expect(query.equalities()).toMatchObject({
      origin_terminal_id: 'origin-1',
      destination_terminal_id: 'destination-1',
      departure_date: '2026-10-01',
    });
    expect(query.in).toHaveBeenCalledWith('status', ['SCHEDULED', 'BOARDING']);
    // Two passengers travelling together are not served by two separate buses.
    expect(query.gte).toHaveBeenCalledWith('available_seats', 2);
  });

  it('narrows by operator, bus type and fare only when asked', async () => {
    const unfiltered = builder({ data: [], error: null });
    from.mockReturnValue(unfiltered);
    await tripService.searchTrips(SEARCH);
    expect(unfiltered.equalities()).not.toHaveProperty('operator_code');
    expect(unfiltered.lte).not.toHaveBeenCalled();

    const filtered = builder({ data: [], error: null });
    from.mockReturnValue(filtered);
    await tripService.searchTrips(SEARCH, {
      operatorCode: 'CHERRY',
      busType: BusType.RORO,
      maxFare: 90000,
    });
    expect(filtered.equalities()).toMatchObject({
      operator_code: 'CHERRY',
      bus_type: BusType.RORO,
    });
    expect(filtered.lte).toHaveBeenCalledWith('fare', 90000);
  });

  describe('departure windows', () => {
    // Half-open and contiguous: noon is afternoon, six is evening, and no
    // departure falls into two windows or none.
    it.each([
      ['MORNING', [['lt', 'departure_time', '12:00']], []],
      [
        'AFTERNOON',
        [
          ['gte', 'departure_time', '12:00'],
          ['lt', 'departure_time', '18:00'],
        ],
        [],
      ],
      ['EVENING', [['gte', 'departure_time', '18:00']], [['lt', 'departure_time', '18:00']]],
    ])('%s', async (window, expected, forbidden) => {
      const query = builder({ data: [], error: null });
      from.mockReturnValue(query);

      await tripService.searchTrips(SEARCH, {
        departureWindow: window as 'MORNING' | 'AFTERNOON' | 'EVENING',
      });

      for (const [method, column, value] of expected as [string, string, string][]) {
        expect(query[method]).toHaveBeenCalledWith(column, value);
      }
      for (const [method, column, value] of forbidden as [string, string, string][]) {
        expect(query[method]).not.toHaveBeenCalledWith(column, value);
      }
    });
  });

  it('raises rather than returning an empty list when the query fails', async () => {
    // An empty list means "no trips today". A swallowed error would say the
    // same thing and be wrong, which is the worse of the two failures.
    from.mockReturnValue(builder({ data: null, error: { code: 'PGRST301', message: 'boom' } }));

    await expect(tripService.searchTrips(SEARCH)).rejects.toThrow();
  });
});

describe('getTrip', () => {
  it('does not filter on status, so a ticket on a withdrawn coach still opens', async () => {
    const query = builder({ data: null, error: { code: 'PGRST116', message: 'none' } });
    from.mockReturnValue(query);

    await expect(tripService.getTrip('trip-1')).rejects.toThrow();

    const applied = query.equalities();
    expect(applied).toMatchObject({ id: 'trip-1' });
    for (const column of ['is_active', 'operator_status', 'route_status', 'bus_status']) {
      expect(applied).not.toHaveProperty(column);
    }
  });
});
