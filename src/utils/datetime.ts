/**
 * Date and time formatting.
 *
 * Trip times are wall-clock strings (`HH:mm:ss`) and dates are calendar dates
 * (`YYYY-MM-DD`), both without a timezone — a 06:00 departure is 06:00 in
 * Palawan regardless of where the phone thinks it is. They are formatted as
 * text rather than parsed into `Date`, because constructing a `Date` from them
 * would apply the device's offset and can shift the day.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `06:00:00` → `6:00 AM` */
export function formatTime(time: string): string {
  const [rawHour, minute] = time.split(':');
  const hour = Number(rawHour);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
}

/** `330` → `5h 30m` */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** `2026-09-15` → `September 15, 2026` */
export function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** `2026-09-15` → `Tue, Sep 15` */
export function formatDateShort(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  // Date.UTC avoids the local-offset day shift; getUTCDay reads it back the same way.
  const weekday = SHORT_DAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday}, ${SHORT_MONTHS[month - 1]} ${day}`;
}

/** Today as `YYYY-MM-DD` in the device's own timezone. */
export function todayISO(): string {
  const now = new Date();
  return toISODate(now);
}

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM-DD` shifted by whole days, staying in calendar space. */
export function addDaysISO(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Whole minutes until an ISO timestamp, floored at zero.
 * Used for the seat-hold countdown.
 */
export function minutesUntil(isoTimestamp: string): number {
  const diff = new Date(isoTimestamp).getTime() - Date.now();
  return Math.max(0, Math.floor(diff / 60_000));
}

/** `mm:ss` remaining until an ISO timestamp, floored at `0:00`. */
export function countdownUntil(isoTimestamp: string): string {
  const seconds = Math.max(0, Math.floor((new Date(isoTimestamp).getTime() - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
