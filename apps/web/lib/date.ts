import { formatDistanceToNow } from "date-fns";

export type DateLanguage = "ENGLISH" | "GERMAN";
export type DateTimeFormatPreference = "TWELVE_HOUR" | "TWENTY_FOUR_HOUR";

export type DateFormattingPreferences = {
  language: DateLanguage;
  timezone: string;
  timeFormat: DateTimeFormatPreference;
};

const DEFAULT_DATE_PREFERENCES: DateFormattingPreferences = {
  language: "ENGLISH",
  timezone: "UTC",
  timeFormat: "TWELVE_HOUR",
};

let datePreferences: DateFormattingPreferences = {
  ...DEFAULT_DATE_PREFERENCES,
};

// ─── Timezone helpers ──────────────────────────────────────────────────────────

/** Returns the user's IANA timezone string (e.g. "America/New_York"). Falls back to "UTC". */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}

function getLocaleForLanguage(language: DateLanguage): string {
  switch (language) {
    case "ENGLISH":
    default:
      return "en-US";
  }
}

function is12Hour(timeFormat: DateTimeFormatPreference): boolean {
  return timeFormat !== "TWENTY_FOUR_HOUR";
}

function getActiveTimezone(): string {
  const timezone = datePreferences.timezone?.trim() || getUserTimezone();
  return timezone || "UTC";
}

function getActiveLocale(): string {
  return getLocaleForLanguage(datePreferences.language);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function setDateFormattingPreferences(
  next: Partial<DateFormattingPreferences>,
): void {
  datePreferences = {
    ...datePreferences,
    ...next,
  };
}

export function getDateFormattingPreferences(): DateFormattingPreferences {
  return { ...datePreferences };
}

/** Returns the short timezone abbreviation (e.g. "EST", "CET", "UTC"). */
export function getTimezoneAbbr(): string {
  try {
    const parts = new Intl.DateTimeFormat(getActiveLocale(), {
      timeZone: getActiveTimezone(),
      timeZoneName: "short",
    }).formatToParts(new Date());

    return parts.find((p) => p.type === "timeZoneName")?.value ?? "UTC";
  } catch {
    return "UTC";
  }
}

// ─── Formatters ────────────────────────────────────────────────────────────────

/**
 * Primary date display in the configured instance timezone.
 * Example: "Feb 23, 2026, 4:28 PM"
 */
export function formatDate(value?: Date | string | null): string {
  const d = toDate(value);
  if (!d) return "—";

  try {
    return d.toLocaleString(getActiveLocale(), {
      timeZone: getActiveTimezone(),
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: is12Hour(datePreferences.timeFormat),
    });
  } catch {
    return d.toLocaleString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }
}

/**
 * Full UTC date string for tooltips.
 * Example: "Feb 23, 2026, 16:28 UTC"
 */
export function formatDateUTC(value?: Date | string | null): string {
  const d = toDate(value);
  if (!d) return "—";

  return (
    d.toLocaleString(getActiveLocale(), {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: is12Hour(datePreferences.timeFormat),
    }) + " UTC"
  );
}

/**
 * Short UTC time for secondary/caption use in tables.
 * Returns "" when the configured timezone is UTC (no duplication).
 */
export function formatShortUTC(value?: Date | string | null): string {
  const d = toDate(value);
  if (!d) return "";
  if (getActiveTimezone() === "UTC") return "";

  return (
    d.toLocaleTimeString(getActiveLocale(), {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: is12Hour(datePreferences.timeFormat),
    }) + " UTC"
  );
}

/**
 * Relative time string (e.g. "2 hours ago").
 */
export function formatRelative(value?: Date | string | null): string {
  const d = toDate(value);
  if (!d) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
}

// ─── Cron description ──────────────────────────────────────────────────────────

/**
 * Log-row timestamp — shows configured timezone with milliseconds.
 */
export function formatLogTimestamp(iso?: string | null): string {
  if (!iso) return "--:--:--";
  const d = toDate(iso);
  if (!d) return "--:--:--";

  try {
    const base = d.toLocaleTimeString(getActiveLocale(), {
      timeZone: getActiveTimezone(),
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: is12Hour(datePreferences.timeFormat),
    });
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${base}.${ms}`;
  } catch {
    return "--:--:--";
  }
}

/**
 * Describe a 5-field UTC cron expression in the configured timezone.
 * Shows the localized equivalent with timezone abbreviation and UTC reference.
 */
export function describeCronLocal(cron: string): string {
  if (!cron) return "";
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minuteStr, hourStr, , , dowStr] = parts;
  const minute = minuteStr ?? "";
  const hour = hourStr ?? "";
  const dow = dowStr ?? "*";

  if (minute === "*" && hour === "*") return "Every minute";
  if (hour === "*") return `Every hour at minute ${minute}`;

  const minuteNum = parseInt(minute, 10);
  const hourNum = parseInt(hour, 10);

  const daysLabel =
    dow === "*"
      ? "Every day"
      : dow === "0"
        ? "Every Sunday"
        : dow === "1"
          ? "Every Monday"
          : dow === "1-5"
            ? "Mon–Fri"
            : `Days ${dow}`;

  if (!isNaN(minuteNum) && !isNaN(hourNum)) {
    const ref = new Date();
    ref.setUTCHours(hourNum, minuteNum, 0, 0);

    const localTime = ref.toLocaleTimeString(getActiveLocale(), {
      timeZone: getActiveTimezone(),
      hour: "2-digit",
      minute: "2-digit",
      hour12: is12Hour(datePreferences.timeFormat),
    });

    const tzAbbr = getTimezoneAbbr();
    const isUTC = getActiveTimezone() === "UTC";
    const utcRef = `${String(hourNum).padStart(2, "0")}:${String(minuteNum).padStart(2, "0")} UTC`;
    const annotation = isUTC ? "" : ` (${utcRef})`;

    return `${daysLabel} at ${localTime} ${tzAbbr}${annotation}`;
  }

  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")} UTC`;
  return `${daysLabel} at ${time}`;
}
