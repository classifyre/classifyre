/**
 * Finding history: stored compact, read as the shape the API has always returned.
 *
 * The same trade as evidence reasons (see embedding/reason-labels.ts), for the
 * same reason. `findings.history` was 213 MB of the 618 MB of row data on one
 * namespace — 816,436 entries across 607,063 findings, with no cap anywhere and
 * no SQL ever looking inside it. Three things accounted for most of it:
 *
 *   - JSONB stores every key name in every row, and these were spelled out in
 *     full 816,436 times;
 *   - `location` was copied onto 607,227 entries from the finding's own
 *     `location` column, and nothing has ever read it back — not the DTO
 *     consumer, not the detail page's history table, not the export;
 *   - `changeReason` repeated one of five system sentences ~209,209 times.
 *
 * So: short keys, event types and system reasons as codes, no location. An
 * operator's own reason is free text and is kept verbatim.
 *
 * Rows written before this change are passed through untouched. There is no
 * backfill and no moment where a finding's history reads as empty; a corpus
 * compacts as its findings are next written.
 */

import { FindingStatus, Prisma, Severity } from '@prisma/client';
import {
  HistoryEventType,
  type FindingHistoryEntry,
} from './finding-history.types';

/**
 * What goes into the database.
 *
 * Short keys on purpose — see the header. Every field is optional but `t`/`e`,
 * because the write sites differ in what they know.
 */
export interface StoredHistoryEntry {
  /** ISO timestamp. */
  t: string;
  /** Event type code. */
  e: string;
  /** Runner id. */
  r?: string;
  /** Status code. */
  s?: string;
  /** Severity code. */
  v?: string;
  /** Detector confidence. */
  c?: number;
  /** Change reason: a system code, or an operator's own words. */
  x?: string;
  /** The user behind a manual change. */
  b?: string;
}

const EVENT_CODES: Record<HistoryEventType, string> = {
  [HistoryEventType.DETECTED]: 'D',
  [HistoryEventType.RE_DETECTED]: 'RD',
  [HistoryEventType.RESOLVED]: 'R',
  [HistoryEventType.STATUS_CHANGED]: 'SC',
  [HistoryEventType.SEVERITY_CHANGED]: 'SV',
  [HistoryEventType.RE_OPENED]: 'RO',
};

const EVENT_BY_CODE = new Map<string, HistoryEventType>(
  Object.entries(EVENT_CODES).map(([event, code]) => [
    code,
    event as HistoryEventType,
  ]),
);

/**
 * The sentences the system writes for itself, by code.
 *
 * Anything not in here is an operator's own wording and travels as text. Codes
 * are `#`-prefixed so a reason that happens to read like one cannot collide.
 */
const SYSTEM_REASONS: Record<string, string> = {
  '#gone': 'Detection no longer present in scan',
  '#asset-deleted': 'Asset deleted from source (full scan)',
  '#detector-removed': 'Detector removed from source configuration',
  '#reopened': 'Re-opened: detection found again after resolution',
  '#file-deleted': 'Uploaded source file deleted',
  '#retained':
    'Detector removed from source configuration, but this finding is kept ' +
    'because a case cites it or an active inquiry watches it',
  '#manual-status': 'Manual status change',
  '#manual-severity': 'Manual severity change',
  '#bulk-status': 'Bulk status change',
};

const REASON_CODES = new Map<string, string>(
  Object.entries(SYSTEM_REASONS).map(([code, text]) => [text, code]),
);

/** The code for a system sentence, or the sentence itself if it is not one. */
export function reasonForStorage(reason: string): string {
  return REASON_CODES.get(reason) ?? reason;
}

/** Turn one entry into what is written. */
export function historyEntryForStorage(
  entry: FindingHistoryEntry,
): StoredHistoryEntry {
  const timestamp =
    entry.timestamp instanceof Date
      ? entry.timestamp.toISOString()
      : String(entry.timestamp);
  return {
    t: timestamp,
    e: EVENT_CODES[entry.eventType] ?? entry.eventType,
    ...(entry.runnerId ? { r: entry.runnerId } : {}),
    ...(entry.status ? { s: entry.status } : {}),
    ...(entry.severity ? { v: entry.severity } : {}),
    ...(entry.confidence != null ? { c: entry.confidence } : {}),
    ...(entry.changeReason ? { x: reasonForStorage(entry.changeReason) } : {}),
    ...(entry.changedBy ? { b: entry.changedBy } : {}),
    // `location` is deliberately absent: it duplicated the finding's own
    // column and no reader has ever touched it.
  };
}

/** Turn a list of entries into what is written. */
export function historyForStorage(
  entries: FindingHistoryEntry[],
): StoredHistoryEntry[] {
  return entries.map(historyEntryForStorage);
}

/**
 * The boundary cast for writing a history array to a JSONB column.
 *
 * Prisma's `InputJsonValue` only accepts objects carrying an index signature,
 * which {@link StoredHistoryEntry} deliberately does not have — an index
 * signature would make `{ tt: 'typo' }` compile. One cast here beats one at
 * every write, and the write sites mix freshly-compacted entries with whatever
 * shape the existing column held.
 */
export function historyColumn(entries: unknown[]): Prisma.InputJsonValue {
  return entries as unknown as Prisma.InputJsonValue;
}

/**
 * One stored entry as the API returns it.
 *
 * Tolerant by design, like `renderReasons`: this runs on every finding read and
 * a malformed entry must cost that entry, never the response.
 */
function renderOne(entry: unknown): FindingHistoryEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const row = entry as Partial<StoredHistoryEntry> &
    Partial<Record<keyof FindingHistoryEntry, unknown>>;

  // Written before this change: already the full shape, kept as-is so an
  // existing corpus reads identically without a backfill.
  if (typeof row.eventType === 'string') {
    return entry as FindingHistoryEntry;
  }

  if (typeof row.t !== 'string' || typeof row.e !== 'string') return null;
  const reason = row.x;
  return {
    timestamp: new Date(row.t),
    runnerId: row.r ?? '',
    eventType: EVENT_BY_CODE.get(row.e) ?? (row.e as HistoryEventType),
    status: row.s as FindingStatus,
    ...(row.v ? { severity: row.v as Severity } : {}),
    ...(row.c != null ? { confidence: row.c } : {}),
    ...(reason ? { changeReason: SYSTEM_REASONS[reason] ?? reason } : {}),
    ...(row.b ? { changedBy: row.b } : {}),
  };
}

/** Every stored entry as the API returns it. */
export function renderHistory(stored: unknown): FindingHistoryEntry[] {
  if (!Array.isArray(stored)) return [];
  const out: FindingHistoryEntry[] = [];
  for (const entry of stored) {
    const rendered = renderOne(entry);
    if (rendered) out.push(rendered);
  }
  return out;
}

/**
 * The most recent entry of a given type, in either stored shape.
 *
 * This is all three of the semantic readers need — whether a status change was
 * manual, whether severity was overridden, what the last note said — and asking
 * for it by name is what keeps them from reaching into the raw JSON and
 * matching on `eventType`, which only one of the two shapes has.
 */
export function lastEntryOfType(
  stored: unknown,
  eventType: HistoryEventType,
): FindingHistoryEntry | undefined {
  if (!Array.isArray(stored)) return undefined;
  const code = EVENT_CODES[eventType];
  for (let i = stored.length - 1; i >= 0; i--) {
    const row = stored[i] as
      | (Partial<StoredHistoryEntry> & { eventType?: unknown })
      | null;
    if (!row || typeof row !== 'object') continue;
    if (row.eventType === eventType || row.e === code) {
      return renderOne(row) ?? undefined;
    }
  }
  return undefined;
}

/** The last entry of any type, rendered. */
export function lastEntry(stored: unknown): FindingHistoryEntry | undefined {
  if (!Array.isArray(stored) || !stored.length) return undefined;
  return renderOne(stored[stored.length - 1]) ?? undefined;
}
