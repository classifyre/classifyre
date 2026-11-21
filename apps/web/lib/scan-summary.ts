/**
 * What a query's live tables cost, for the line under the editor
 * (docs/prd/QC-query-connectors.md §5.9): a Meilisearch index or a Neo4j
 * label is read through its source's API on every query, so the person sees
 * how many requests and rows it took and which filters went to the source.
 */
export interface ScanStatLike {
  table: string;
  requests: number;
  rows: number;
  pushed: string[];
}

export interface ScanSummary {
  tables: number;
  requests: number;
  rows: number;
  /** One per table: `movies: 1 request, 632 rows; sent genre = 'Drama'`. */
  details: { table: string; requests: number; rows: number; pushed: string }[];
}

export function scanSummary(
  scans: readonly ScanStatLike[] | null | undefined,
): ScanSummary | null {
  if (!scans?.length) return null;
  return {
    tables: scans.length,
    requests: scans.reduce((sum, s) => sum + s.requests, 0),
    rows: scans.reduce((sum, s) => sum + s.rows, 0),
    details: scans.map((s) => ({
      table: s.table,
      requests: s.requests,
      rows: s.rows,
      pushed: s.pushed.join(", "),
    })),
  };
}
