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
