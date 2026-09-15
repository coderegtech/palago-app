import {
  freeFrom,
  isCalendarDate,
  isOvernight,
  isTimeOfDay,
  journeyMinutes,
} from '../schedule';

describe('isTimeOfDay', () => {
  it('accepts HH:mm and HH:mm:ss', () => {
    expect(isTimeOfDay('06:00')).toBe(true);
    expect(isTimeOfDay('06:00:00')).toBe(true);
    expect(isTimeOfDay(' 23:59 ')).toBe(true);
  });

  it('rejects times that are not times', () => {
    expect(isTimeOfDay('24:00')).toBe(false);
    expect(isTimeOfDay('12:60')).toBe(false);
    expect(isTimeOfDay('6:00')).toBe(false);
    expect(isTimeOfDay('')).toBe(false);
    expect(isTimeOfDay('noon')).toBe(false);
  });
});

describe('isCalendarDate', () => {
  it('accepts a real date', () => {
    expect(isCalendarDate('2026-09-20')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
  });

  it('rejects a day that does not exist', () => {
    // `new Date('2026-02-30')` rolls over to 2 March rather than failing, so a
    // parse alone would wave this through.
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2027-02-29')).toBe(false);
  });

  it('rejects anything not in YYYY-MM-DD', () => {
    expect(isCalendarDate('20/09/2026')).toBe(false);
    expect(isCalendarDate('2026-9-20')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
  });
});

describe('isOvernight', () => {
  it('is false for an ordinary daytime run', () => {
    expect(isOvernight('06:00', '12:00')).toBe(false);
  });

  it('is true when the arrival is earlier in the day than the departure', () => {
    expect(isOvernight('20:00', '06:00')).toBe(true);
  });

  it('treats an equal arrival as the next day, not a zero-length trip', () => {
    expect(isOvernight('20:00', '20:00')).toBe(true);
  });

  it('says nothing about times it cannot read', () => {
    expect(isOvernight('20:00', 'later')).toBe(false);
  });
});

describe('journeyMinutes', () => {
  it('measures an ordinary run', () => {
    expect(journeyMinutes('06:00', '11:30')).toBe(330);
  });

  it('rolls an overnight sailing forward rather than going negative', () => {
    // The trap: 06:00 − 20:00 is minus fourteen hours, which would make an
    // overnight departure look like it occupies no time at all.
    expect(journeyMinutes('20:00', '06:00')).toBe(600);
  });

  it('treats equal times as a full day', () => {
    expect(journeyMinutes('20:00', '20:00')).toBe(24 * 60);
  });

  it('handles seconds in the input', () => {
    expect(journeyMinutes('06:00:00', '11:30:00')).toBe(330);
  });

  it('returns null rather than guessing', () => {
    expect(journeyMinutes('06:00', '')).toBeNull();
  });
});

describe('freeFrom', () => {
  it('adds the turnaround to the arrival', () => {
    expect(freeFrom('2026-09-20', '06:00', '12:00', 30)).toBe('2026-09-20T12:30');
  });

  it('crosses midnight for an overnight run', () => {
    expect(freeFrom('2026-09-20', '20:00', '06:00', 30)).toBe('2026-09-21T06:30');
  });

  it('crosses a month boundary', () => {
    expect(freeFrom('2026-09-30', '20:00', '06:00', 90)).toBe('2026-10-01T07:30');
  });

  it('treats a zero buffer as "free on arrival"', () => {
    expect(freeFrom('2026-09-20', '06:00', '12:00', 0)).toBe('2026-09-20T12:00');
  });

  it('never subtracts time for a negative buffer', () => {
    expect(freeFrom('2026-09-20', '06:00', '12:00', -60)).toBe('2026-09-20T12:00');
  });

  it('returns null for input it cannot read', () => {
    expect(freeFrom('2026-02-30', '06:00', '12:00', 30)).toBeNull();
    expect(freeFrom('2026-09-20', 'morning', '12:00', 30)).toBeNull();
  });
});
