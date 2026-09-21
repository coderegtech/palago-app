import {
  addDaysISO,
  countdownUntil,
  formatDate,
  formatDateShort,
  formatTimestamp,
  formatTimestampDate,
  formatDuration,
  formatTime,
  minutesUntil,
  timeAgo,
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

describe('timeAgo', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const ago = (iso: string) => timeAgo(iso, now);

  it('says "just now" under a minute', () => {
    expect(ago('2026-09-14T11:59:30Z')).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(ago('2026-09-14T11:45:00Z')).toBe('15m ago');
    expect(ago('2026-09-14T09:00:00Z')).toBe('3h ago');
    expect(ago('2026-09-12T12:00:00Z')).toBe('2d ago');
  });

  it('falls back to a date once it is more than a week old', () => {
    // "37d ago" tells a reader nothing they can act on.
    expect(ago('2026-08-08T12:00:00Z')).toMatch(/Aug/);
  });

  it('does not report a negative age when a clock runs fast', () => {
    expect(ago('2026-09-14T12:05:00Z')).toBe('just now');
  });
});

describe('timestamps', () => {
  // Built from local components so the expectation holds in any timezone the
  // tests run in, exactly as the device's zone is what the screen should use.
  const local = new Date(2026, 8, 19, 13, 5);
  const iso = local.toISOString();

  it('formats a server timestamp — never "NaN", which formatDate(timestamp) gave', () => {
    expect(formatTimestampDate(iso)).toBe('September 19, 2026');
    expect(formatTimestamp(iso)).toBe('Sep 19, 2026 · 1:05 PM');
    expect(formatTimestamp(iso)).not.toContain('NaN');
  });

  it('uses the local calendar day, not the UTC one', () => {
    // 00:30 local is still the previous day in UTC anywhere east of Greenwich —
    // Palawan included — which is what `.slice(0, 10)` got wrong.
    const justAfterMidnight = new Date(2026, 8, 20, 0, 30).toISOString();
    expect(formatTimestampDate(justAfterMidnight)).toBe('September 20, 2026');
  });

  it('accepts the microsecond, offset form PostgREST returns', () => {
    const utc = new Date(Date.UTC(2026, 8, 19, 5, 12, 33));
    const postgrest = '2026-09-19T05:12:33.123456+00:00';
    expect(formatTimestampDate(postgrest)).toBe(formatTimestampDate(utc.toISOString()));
  });
});
