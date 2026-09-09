import {
  addDaysISO,
  countdownUntil,
  formatDate,
  formatDateShort,
  formatDuration,
  formatTime,
  minutesUntil,
  toISODate,
} from '@/utils/datetime';

describe('formatTime', () => {
  it('renders 12-hour time with a meridiem', () => {
    expect(formatTime('06:00:00')).toBe('6:00 AM');
    expect(formatTime('13:00:00')).toBe('1:00 PM');
    expect(formatTime('20:30:00')).toBe('8:30 PM');
  });

  it('renders midnight and noon as 12, not 0', () => {
    expect(formatTime('00:00:00')).toBe('12:00 AM');
    expect(formatTime('12:00:00')).toBe('12:00 PM');
  });

  it('accepts times without seconds', () => {
    expect(formatTime('07:05')).toBe('7:05 AM');
  });
});

describe('formatDuration', () => {
  it('renders hours and minutes', () => {
    expect(formatDuration(330)).toBe('5h 30m');
    expect(formatDuration(600)).toBe('10h');
    expect(formatDuration(45)).toBe('45m');
  });
});

describe('calendar dates', () => {
  it('formats without shifting the day', () => {
    // The bug this guards: `new Date('2026-09-15')` parses as UTC midnight, and
    // west of Greenwich prints as the 14th.
    expect(formatDate('2026-09-15')).toBe('September 15, 2026');
    expect(formatDateShort('2026-09-15')).toBe('Tue, Sep 15');
  });

  it('adds days in calendar space, across a month boundary', () => {
    expect(addDaysISO('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysISO('2026-09-15', 7)).toBe('2026-09-22');
  });

  it('handles a leap day', () => {
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysISO('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('formats a local Date as YYYY-MM-DD using local parts', () => {
    expect(toISODate(new Date(2026, 8, 5))).toBe('2026-09-05');
  });
});

describe('countdowns', () => {
  const now = new Date('2026-09-09T10:00:00.000Z').getTime();

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts down in mm:ss', () => {
    expect(countdownUntil(new Date(now + 10 * 60_000).toISOString())).toBe('10:00');
    expect(countdownUntil(new Date(now + 65_000).toISOString())).toBe('1:05');
    expect(countdownUntil(new Date(now + 9_000).toISOString())).toBe('0:09');
  });

  it('floors at zero rather than going negative', () => {
    expect(countdownUntil(new Date(now - 60_000).toISOString())).toBe('0:00');
    expect(minutesUntil(new Date(now - 60_000).toISOString())).toBe(0);
  });

  it('reports whole minutes remaining', () => {
    expect(minutesUntil(new Date(now + 9.5 * 60_000).toISOString())).toBe(9);
  });
});
