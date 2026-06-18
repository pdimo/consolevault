/**
 * The single shared Pacific-Time date utility (CLAUDE.md hard rule 7).
 *
 * GSC's date boundaries are Pacific Time. Deriving "today" or the newest finalized day in any
 * other zone requests non-existent days or misses the newest one. All GSC date logic routes here.
 */

const PT_ZONE = 'America/Los_Angeles';

/** ISO `YYYY-MM-DD` for the given instant in Pacific Time (defaults to now). */
export function pacificDate(at: Date = new Date()): string {
  // en-CA yields YYYY-MM-DD; timeZone forces the PT calendar day.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PT_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Today's date in Pacific Time, `YYYY-MM-DD`. */
export function todayPacific(at: Date = new Date()): string {
  return pacificDate(at);
}

/** Add (or subtract) whole days to an ISO `YYYY-MM-DD` date, returning ISO `YYYY-MM-DD`. */
export function addDays(isoDate: string, days: number): string {
  assertIsoDate(isoDate);
  // Anchor at UTC noon so ±day arithmetic never crosses a DST edge.
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The newest finalized day available from the API: today (PT) minus `offsetDays`.
 * GSC finalizes data a few days back, so collecting today would yield partial/empty data.
 */
export function newestFinalizedDay(offsetDays: number, at: Date = new Date()): string {
  return addDays(todayPacific(at), -offsetDays);
}

/** True for a well-formed `YYYY-MM-DD` calendar date. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function assertIsoDate(value: string): void {
  if (!isIsoDate(value)) {
    throw new Error(`Invalid ISO date (expected YYYY-MM-DD): ${value}`);
  }
}

/** Subtract whole months from an ISO date (approximate at month-length edges; fine for windows). */
export function subtractMonths(isoDate: string, months: number): string {
  assertIsoDate(isoDate);
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Inclusive ascending list of ISO days from start to end (empty if start > end). */
export function daysInRange(start: string, end: string): string[] {
  assertIsoDate(start);
  assertIsoDate(end);
  const days: string[] = [];
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) {
    days.push(cur);
  }
  return days;
}

/** The API exposes a rolling ~16-month window; never plan/expect older than that. */
export const MAX_BACKFILL_MONTHS = 16;

/**
 * The [oldest, newest] collection window for a property's config, clamped to the API's 16 months.
 * newest = today(PT) − offsetDays; oldest = today − backfillMonths (clamped). Shared by the
 * planner (Stage 3) and the coverage view (Stage 4).
 */
export function windowFor(
  offsetDays: number,
  backfillMonths: number,
  now?: Date,
): { oldest: string; newest: string } {
  const today = todayPacific(now);
  const newest = newestFinalizedDay(offsetDays, now);
  const apiOldest = subtractMonths(today, MAX_BACKFILL_MONTHS);
  let oldest = subtractMonths(today, backfillMonths);
  if (oldest < apiOldest) oldest = apiOldest;
  if (oldest > newest) oldest = newest;
  return { oldest, newest };
}
