import {
  type BoardingDoor,
  doorLabel,
  idsToBoard,
  isBoardable,
} from '@/components/common/boarding-door';

const door: BoardingDoor = {
  tripId: 'trip-a',
  tripNumber: 'CHERRY-0911-A',
  status: 'BOARDING',
  departureDate: '2026-09-11',
  departureTime: '06:00:00',
  originCode: 'PPS',
  destinationCode: 'ELN',
  busNumber: '12',
  passengerCount: 3,
  boardedCount: 1,
};

describe('isBoardable', () => {
  it('accepts trips that can still take passengers', () => {
    expect(isBoardable({ ...door, status: 'SCHEDULED' })).toBe(true);
    expect(isBoardable({ ...door, status: 'BOARDING' })).toBe(true);
  });

  it('rejects trips that have left or were cancelled', () => {
    for (const status of ['DEPARTED', 'ON_TRIP', 'ARRIVED', 'COMPLETED', 'CANCELLED'] as const) {
      expect(isBoardable({ ...door, status })).toBe(false);
    }
  });
});

describe('doorLabel', () => {
  it('names the route, time and bus the operator is standing at', () => {
    expect(doorLabel(door)).toContain('PPS → ELN');
    expect(doorLabel(door)).toContain('Bus 12');
  });
});

describe('idsToBoard', () => {
  it('sends nothing when everyone waiting is ticked, so the server boards all remaining', () => {
    expect(idsToBoard(['a', 'b'], new Set(['a', 'b']))).toBeUndefined();
  });

  it('sends exactly the ticked passengers when someone is held back', () => {
    expect(idsToBoard(['a', 'b', 'c'], new Set(['a', 'c']))).toEqual(['a', 'c']);
  });

  it('ignores ticks for passengers who are not waiting', () => {
    // "z" boarded at another door after the scan; it must not be re-sent.
    expect(idsToBoard(['a', 'b'], new Set(['a', 'z']))).toEqual(['a']);
  });

  it('sends an empty list rather than "everyone" when nobody is ticked', () => {
    expect(idsToBoard(['a'], new Set())).toEqual([]);
  });
});
