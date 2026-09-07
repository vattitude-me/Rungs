/** All date handling in the app goes through here.
 *
 * The rule: a "day" is a LOCAL calendar day, never a UTC one. `toISOString()`
 * is UTC, so in any timezone east of Greenwich it flips the app's idea of
 * "today" partway through the local morning (UTC+11 flips at 11:00 local),
 * which made the dashboard serve yesterday's plan for hours. */

/** Local-calendar YYYY-MM-DD for a Date (default: now). */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parses a YYYY-MM-DD as local midnight (`new Date('2026-09-03')` parses as
 * UTC midnight, which is the previous local day in western timezones). */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The local calendar date `days` after `iso`. Goes through a local Date so a
 * DST boundary in between still lands on the right calendar day. */
export function addDays(iso: string, days: number): string {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

/** Whole local calendar days between two YYYY-MM-DD strings. DST-safe: both
 * sides are normalised to local midnight before differencing, and the result
 * is rounded so a 23- or 25-hour day still counts as exactly one. */
export function daysBetweenDates(fromIso: string, toIso: string): number {
  const a = parseLocalDate(fromIso).getTime();
  const b = parseLocalDate(toIso).getTime();
  return Math.round((b - a) / 86400000);
}

/** Which day of the program a given local date is, counted in calendar days
 * from the day the profile was created. Day 1 (the day you onboarded) is
 * index 0. Counting elapsed milliseconds instead would roll the program over
 * at whatever time of day onboarding happened, not at midnight. */
export function dayIndexFor(createdAt: number, todayIso: string = localDate()): number {
  const created = localDate(new Date(createdAt));
  return Math.max(0, daysBetweenDates(created, todayIso));
}

/** Minutes since local midnight, for a HH:MM string. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes since local midnight, right now. */
export function nowMinutes(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** HH:MM in local time. */
export function localTime(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
