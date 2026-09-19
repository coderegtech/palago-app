import { shouldPublishFix } from '@/utils/location-throttle';

describe('shouldPublishFix', () => {
  const INTERVAL = 20_000;

  it('publishes the first fix at once', () => {
    expect(shouldPublishFix(null, 1_000, INTERVAL)).toBe(true);
  });

  it('drops fixes that arrive inside the interval — the iOS every-25-metres case', () => {
    const start = 100_000;
    // One fix a second for the whole interval, as iOS delivers them at speed.
    const published = Array.from({ length: 20 }, (_, i) => start + i * 1_000).filter((t) =>
      shouldPublishFix(start, t, INTERVAL),
    );
    expect(published).toEqual([]);
  });

  it('publishes once the interval has passed', () => {
    expect(shouldPublishFix(100_000, 120_000, INTERVAL)).toBe(true);
    expect(shouldPublishFix(100_000, 119_999, INTERVAL)).toBe(false);
  });

  it('caps a run of a fix per second to one publish per interval', () => {
    let last: number | null = null;
    let sent = 0;
    for (let t = 0; t < 60_000; t += 1_000) {
      if (shouldPublishFix(last, t, INTERVAL)) {
        last = t;
        sent += 1;
      }
    }
    expect(sent).toBe(3); // t = 0, 20 s, 40 s
  });

  it('does not go silent when the clock moves backwards', () => {
    expect(shouldPublishFix(500_000, 400_000, INTERVAL)).toBe(true);
  });
});
