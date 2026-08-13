/**
 * Timestamps are stored as ISO strings and dates as `YYYY-MM-DD`, both in UTC.
 * These two helpers are the only places that assumption is encoded.
 */

/** Fractional hours between now and an ISO timestamp. Negative once it is past. */
export function hoursUntil(iso: string, now = new Date()): number {
  return (new Date(iso).getTime() - now.getTime()) / 36e5;
}

/** Today as `YYYY-MM-DD`, the format the date-only columns use. */
export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Adds whole days to a date, returning `YYYY-MM-DD`. */
export function addDays(dateIso: string, days: number): string {
  const date = new Date(dateIso);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
