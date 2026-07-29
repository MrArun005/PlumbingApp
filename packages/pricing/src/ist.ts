/**
 * IST calendar arithmetic, done explicitly (BUILD-PROMPT rule 9): store UTC,
 * compute business time in Asia/Kolkata. IST is UTC+05:30 with no DST, so a
 * fixed offset is correct and keeps this module pure (no Intl, no locale).
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export interface IstParts {
  /** 0–23 hour of day in IST */
  hour: number;
  /** 0 = Sunday … 6 = Saturday, in IST */
  weekday: number;
  /** "YYYY-MM-DD" calendar date in IST */
  date: string;
}

export function istParts(now: Date): IstParts {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay(),
    date: shifted.toISOString().slice(0, 10),
  };
}

/**
 * Is `hour` inside the window [startHour, endHour)? Handles windows that
 * wrap midnight (e.g. 22 → 6) as well as ordinary ones (e.g. 9 → 18).
 */
export function hourInWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false; // zero-length window
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour; // wraps midnight
}
