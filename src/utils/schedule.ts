/**
 * The scheduling rules the client can state without asking the server.
 *
 * Pure, and kept out of the form component, because these are the parts that
 * are easy to get quietly wrong: an arrival "before" a departure is an
 * overnight run, not a negative journey, and a coach is not free the moment it
 * docks.
 *
 * None of this decides whether a departure is allowed. That is an exclusion
 * constraint in the database, under concurrency — two people pressing Save at
 * the same instant would both read "free" here and both be wrong. What this
 * does is let the form say what is about to be asked for before asking.
 */

import type { ISODate, ISOTime } from '@/types/models';

/** `HH:mm` or `HH:mm:ss`, and a real time of day. */
export function isTimeOfDay(value: string): boolean {
  const match = /^(\d{2}):(\d{2})(:\d{2})?$/.exec(value.trim());
  if (!match) return false;
  return Number(match[1]) < 24 && Number(match[2]) < 60;
}

/** `YYYY-MM-DD`, and a date that exists. */
export function isCalendarDate(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;

  const [year, month, day] = trimmed.split('-').map(Number);
  // A rolled-over date (2026-02-30 → 2026-03-02) parses perfectly well, so
  // compare the parts back. Deliberately NOT through `toISOString()`: a
  // date-with-time string is parsed as LOCAL time and that method prints UTC,
  // so east of Greenwich every valid date would come back a day early.
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

/**
 * Does this journey end the next day?
 *
 * An arrival at or *equal to* the departure time counts: a zero-length trip is
 * not a thing, so 20:00 → 20:00 is a full twenty-four hours. This mirrors
 * `public.trip_arrival_timestamp` exactly — if the two ever disagree, the form
 * would tell somebody their overnight sailing is minus fourteen hours long.
 */
export function isOvernight(departureTime: ISOTime, arrivalTime: ISOTime): boolean {
  if (!isTimeOfDay(departureTime) || !isTimeOfDay(arrivalTime)) return false;
  return arrivalTime.slice(0, 5) <= departureTime.slice(0, 5);
}

/** Journey length in minutes, rolling overnight the same way the database does. */
export function journeyMinutes(departureTime: ISOTime, arrivalTime: ISOTime): number | null {
  if (!isTimeOfDay(departureTime) || !isTimeOfDay(arrivalTime)) return null;

  const toMinutes = (time: string) => {
    const [h, m] = time.slice(0, 5).split(':').map(Number);
    return h * 60 + m;
  };

  const departure = toMinutes(departureTime);
  const arrival = toMinutes(arrivalTime);
  return arrival <= departure ? arrival + 24 * 60 - departure : arrival - departure;
}

/**
 * When the coach is free again: the arrival plus the turnaround buffer.
 *
 * Returned as a wall-clock `YYYY-MM-DDTHH:mm` rather than a Date, for the same
 * reason the database stores `timestamp` and not `timestamptz` — Palawan is one
 * zone, and a value that shifts with the reader's zone would make the form and
 * the server disagree about what overlaps.
 */
export function freeFrom(
  departureDate: ISODate,
  departureTime: ISOTime,
  arrivalTime: ISOTime,
  turnaroundMinutes: number,
): string | null {
  const journey = journeyMinutes(departureTime, arrivalTime);
  if (journey === null || !isCalendarDate(departureDate)) return null;

  const [h, m] = departureTime.slice(0, 5).split(':').map(Number);
  const start = new Date(`${departureDate}T00:00:00`);
  start.setMinutes(start.getMinutes() + h * 60 + m + journey + Math.max(0, turnaroundMinutes));

  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}` +
    `T${pad(start.getHours())}:${pad(start.getMinutes())}`
  );
}
