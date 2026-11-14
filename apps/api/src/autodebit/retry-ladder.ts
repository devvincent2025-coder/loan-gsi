/**
 * Pure helpers for the autodebit retry ladder (env.AUTODEBIT_RETRY_LADDER, default
 * "DUE_AM,DUE_PM,DAY_PLUS_1,DAY_PLUS_3,DAY_PLUS_7_GSI"). No I/O, fully unit-testable.
 *
 * Stage naming convention: a stage whose name has no digits (e.g. "DUE_AM"/"DUE_PM") fires on the
 * instalment's due date (offset 0); a stage containing "DAY_PLUS_<n>" fires n days after the due date.
 * The LAST stage in the ladder is the GSI fallback (its name contains "GSI") and, once reached, keeps
 * firing every day thereafter until the instalment is cleared or written off.
 */

const LAGOS_TZ = 'Africa/Lagos';

/** The calendar date (midnight UTC) as it reads on a wall clock in Africa/Lagos (UTC+1, no DST) at instant `now`. */
export function lagosToday(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: LAGOS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = parts.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** The hour-of-day (0-23) on a wall clock in Africa/Lagos at instant `now`. */
export function lagosHourOf(now = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: LAGOS_TZ, hour: '2-digit', hour12: false }).format(now));
}

/** Days-past-due for a due date as at `today` (both compared as calendar dates, ignoring time-of-day). */
export function daysPastDue(dueDate: Date, today: Date): number {
  const d = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((t - d) / 86_400_000);
}

/** Numeric offset encoded in a stage name; stages with no digits (DUE_AM/DUE_PM) are offset 0. */
export function parseStageOffset(stage: string): number {
  const m = /(\d+)/.exec(stage);
  return m ? Number(m[1]) : 0;
}

export function isGsiStage(stage: string): boolean {
  return /GSI/i.test(stage);
}

export function parseRetryLadder(spec: string): string[] {
  return spec.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Which ladder stage (if any) is due "today" for an instalment with the given `dpd` (days past due,
 * from `daysPastDue`). `lagosHour` (0-23) picks between same-day stages (DUE_AM vs DUE_PM); only
 * relevant when dpd === 0. Returns null when no stage is due yet. Once dpd passes the last stage's
 * offset, the last stage (GSI fallback) is returned every day.
 */
export function computeRetryStage(dpd: number, ladder: string[], lagosHour = 7): string | null {
  if (!ladder.length || dpd < 0) return null;
  const dueStages = ladder.filter((s) => parseStageOffset(s) === 0);
  if (dpd === 0) {
    if (!dueStages.length) return null;
    return lagosHour < 12 ? dueStages[0] : (dueStages[dueStages.length - 1] ?? dueStages[0]);
  }
  const laterStages = ladder.filter((s) => parseStageOffset(s) > 0);
  if (!laterStages.length) return null;
  const exact = laterStages.find((s) => parseStageOffset(s) === dpd);
  if (exact) return exact;
  const last = laterStages[laterStages.length - 1];
  return dpd > parseStageOffset(last) ? last : null;
}
