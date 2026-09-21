/**
 * When should a cron schedule last have fired?
 *
 * pg-boss fires a cron only while something is listening at the moment the
 * clock matches: a window that passes while the instance is down is simply
 * lost, and nothing replays it. On an instance that is not up 24/7 (a laptop
 * cluster, a nightly-maintenance window) a "daily at 06:15" source can then go
 * for weeks without a single run, with its schedule showing as enabled and
 * healthy — which is exactly what happened to the GENESIS namespaces.
 *
 * `previousCronOccurrence` answers the question the catch-up pass needs: the
 * most recent wall-clock instant, in the schedule's own timezone, at which this
 * expression matched. Comparing it with the source's last run says whether a
 * window was missed.
 *
 * Deliberately no dependency: the API accepts only the five numeric cron fields
 * (`assertValidCronExpression`), and a bounded minute-by-minute walk backwards
 * over the search window is both exact across DST changes (each candidate is a
 * real instant, formatted in the target zone) and cheap — at most 8 days of
 * minutes, and it stops at the first match.
 */

/** Minutes to walk back before giving up. 8 days covers every weekly schedule. */
const MAX_LOOKBACK_MINUTES = 8 * 24 * 60;

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** Cron's OR rule: with both day fields restricted, either may match. */
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
}

/** Expand one cron field (star, "5", "1-4", a step like every third, "1,15") into the values it matches. */
function expandField(
  raw: string,
  min: number,
  max: number,
): Set<number> | null {
  const values = new Set<number>();
  for (const part of raw.split(',')) {
    if (!part) return null;
    const [range, stepRaw] = part.split('/');
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step <= 0) return null;

    let from: number;
    let to: number;
    if (range === '*' || range === '') {
      from = min;
      to = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      from = Number(a);
      to = Number(b);
    } else {
      from = Number(range);
      to = stepRaw === undefined ? from : max;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
    if (from < min || to > max || from > to) return null;
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return values.size > 0 ? values : null;
}

function parseCron(cron: string): CronFields | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, month, dow] = parts;

  const minute = expandField(min, 0, 59);
  const hours = expandField(hour, 0, 23);
  const dayOfMonth = expandField(dom, 1, 31);
  const months = expandField(month, 1, 12);
  // Both 0 and 7 mean Sunday.
  const dayOfWeekRaw = expandField(dow, 0, 7);
  if (!minute || !hours || !dayOfMonth || !months || !dayOfWeekRaw) return null;

  const dayOfWeek = new Set(
    [...dayOfWeekRaw].map((value) => (value === 7 ? 0 : value)),
  );
  return {
    minute,
    hour: hours,
    dayOfMonth,
    month: months,
    dayOfWeek,
    dayOfMonthRestricted: dom.trim() !== '*',
    dayOfWeekRestricted: dow.trim() !== '*',
  };
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Wall-clock fields of `instant` as seen in `timeZone`. */
function zonedParts(
  instant: Date,
  timeZone: string,
): {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(instant);

  const read = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const weekdayName = parts.find((p) => p.type === 'weekday')?.value ?? '';
  // 24:00 is midnight of the same day in some locales' hourCycle.
  const hour = read('hour') % 24;
  return {
    minute: read('minute'),
    hour,
    day: read('day'),
    month: read('month'),
    weekday: WEEKDAYS[weekdayName] ?? -1,
  };
}

function matches(
  fields: CronFields,
  at: ReturnType<typeof zonedParts>,
): boolean {
  if (!fields.minute.has(at.minute)) return false;
  if (!fields.hour.has(at.hour)) return false;
  if (!fields.month.has(at.month)) return false;

  const domMatch = fields.dayOfMonth.has(at.day);
  const dowMatch = fields.dayOfWeek.has(at.weekday);
  // Standard cron: restricting both day fields means "either", not "both".
  if (fields.dayOfMonthRestricted && fields.dayOfWeekRestricted) {
    return domMatch || dowMatch;
  }
  if (fields.dayOfMonthRestricted) return domMatch;
  if (fields.dayOfWeekRestricted) return dowMatch;
  return true;
}

/**
 * The most recent instant at or before `now` when `cron` matched in `timeZone`,
 * or null when the expression is unsupported or did not match inside the
 * lookback window (a monthly or quarterly schedule usually has not).
 */
export function previousCronOccurrence(
  cron: string,
  timeZone: string,
  now: Date = new Date(),
  lookbackMinutes: number = MAX_LOOKBACK_MINUTES,
): Date | null {
  const fields = parseCron(cron);
  if (!fields) return null;

  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  // Start at the top of the current minute: a schedule due this minute counts.
  const cursor = new Date(now);
  cursor.setUTCSeconds(0, 0);

  for (let i = 0; i <= lookbackMinutes; i += 1) {
    if (matches(fields, zonedParts(cursor, zone))) return new Date(cursor);
    cursor.setUTCMinutes(cursor.getUTCMinutes() - 1);
  }
  return null;
}

function isValidTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
