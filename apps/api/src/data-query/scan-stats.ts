/**
 * What reading each connector table of a query cost
 * (docs/prd/QC-query-connectors.md §5.3, §5.9): the job sends it as `scans`
 * with the result; the run keeps it, so a person sees how many requests and
 * rows a live source took, and which filters went to it.
 */
export interface ScanStat {
  /** The table's SQL name. */
  table: string;
  /** Calls to the source. */
  requests: number;
  /** Rows the source sent. */
  rows: number;
  /** The conditions sent to the source, as SQL (`genre = 'Drama'`). */
  pushed: string[];
  ms: number;
  /** How often the query read the table (a self-join reads it twice). */
  scans: number;
}

const MAX_TABLES = 64;
const MAX_PUSHED = 32;

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/** The job's `scans`, kept only in the shape above (it is stored as sent). */
export function scanStatsOf(value: unknown): ScanStat[] {
  if (!Array.isArray(value)) return [];
  const out: ScanStat[] = [];
  for (const entry of value.slice(0, MAX_TABLES)) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.table !== 'string' || !raw.table) continue;
    out.push({
      table: raw.table.slice(0, 300),
      requests: count(raw.requests),
      rows: count(raw.rows),
      pushed: Array.isArray(raw.pushed)
        ? raw.pushed
            .filter((p): p is string => typeof p === 'string')
            .slice(0, MAX_PUSHED)
            .map((p) => p.slice(0, 500))
        : [],
      ms: count(raw.ms),
      scans: count(raw.scans),
    });
  }
  return out;
}
