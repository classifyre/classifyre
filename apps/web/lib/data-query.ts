"use client";

import { api } from "@workspace/api-client";
import type {
  QueryCatalogDto,
  QueryCatalogTableDto,
  QueryRunDto,
} from "@workspace/api-client";

/**
 * SQL over the tables of a workspace (docs/prd/DQ-data-query.md): run a
 * query as a job, poll it, then read its rows from an Arrow IPC stream.
 */

export type QueryCatalog = QueryCatalogDto;
export type QueryCatalogTable = QueryCatalogTableDto;
export type QueryRun = QueryRunDto;
export type { SavedQueryDto, SaveSavedQueryDto } from "@workspace/api-client";

export const TERMINAL_STATUSES = new Set([
  "SUCCESS",
  "ERROR",
  "TIMEOUT",
  "CANCELLED",
]);

export interface QueryRows {
  columns: { name: string; type: string }[];
  rows: unknown[][];
}

const POLL_MS = 600;

export async function fetchCatalog(): Promise<QueryCatalog> {
  return api.dataQuery.dataQueryControllerGetCatalog();
}

export type ExportFormat = "xlsx" | "csv" | "parquet";

export async function startQuery(
  sql: string,
  format?: ExportFormat,
): Promise<QueryRun> {
  return api.dataQuery.dataQueryControllerCreate({
    createQueryRunDto: { sql, ...(format ? { format } : {}) },
  });
}

/** Save an export's file through the browser, named as the API names it. */
export async function downloadExport(run: QueryRun): Promise<void> {
  const response = await api.dataQuery.dataQueryControllerResultRaw({
    id: run.id,
  });
  const blob = await response.raw.blob();
  const disposition = response.raw.headers.get("Content-Disposition") ?? "";
  const name =
    /filename="([^"]+)"/.exec(disposition)?.[1] ??
    `query.${run.resultFormat ?? "csv"}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function cancelQuery(id: string): Promise<QueryRun> {
  return api.dataQuery.dataQueryControllerCancel({ id });
}

export async function fetchRecentRuns(limit = 30): Promise<QueryRun[]> {
  return api.dataQuery.dataQueryControllerList({ limit });
}

export async function fetchSavedQueries(): Promise<
  import("@workspace/api-client").SavedQueryDto[]
> {
  return api.dataQuery.dataQueryControllerListSaved();
}

export async function createSavedQuery(
  name: string,
  sql: string,
): Promise<import("@workspace/api-client").SavedQueryDto> {
  return api.dataQuery.dataQueryControllerCreateSaved({
    saveSavedQueryDto: { name, sql },
  });
}

export async function updateSavedQuery(
  id: string,
  patch: { name?: string; sql?: string },
): Promise<import("@workspace/api-client").SavedQueryDto> {
  return api.dataQuery.dataQueryControllerUpdateSaved({
    id,
    saveSavedQueryDto: { name: patch.name ?? "", sql: patch.sql ?? "" },
  });
}

export async function deleteSavedQuery(id: string): Promise<void> {
  await api.dataQuery.dataQueryControllerRemoveSaved({ id });
}

/**
 * What to start the editor with: a preview of your first queryable table, in
 * full three-part `source.schema.table` form (cross-source SQL needs it).
 */
export function starterSql(catalog: QueryCatalog | null): {
  sql: string;
  title: string;
} {
  const first = (catalog?.sources ?? [])
    .flatMap((s) => s.tables)
    .find((t) => t.canQuery);
  if (!first) return { sql: "SELECT 1", title: "Empty query" };
  return { sql: previewSql(first.sqlName), title: first.sqlName };
}

/** The preview query over one table: what a Data tab and a play button open. */
export function previewSql(sqlName: string): string {
  return `SELECT *\nFROM ${sqlName}\nLIMIT 100`;
}

/** How long polling rides out a gateway that does not answer (an API restart). */
const POLL_GRACE_MS = 90_000;

function isTransient(error: unknown): boolean {
  const status = (error as { response?: Response })?.response?.status;
  // No response at all (network) or a gateway/availability error: retry.
  return (
    status === undefined || status === 502 || status === 503 || status === 504
  );
}

/** Poll a run until it ends; `onUpdate` sees every state on the way. */
export async function waitForRun(
  id: string,
  onUpdate: (run: QueryRun) => void,
  signal?: AbortSignal,
): Promise<QueryRun> {
  let failingSince: number | null = null;
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const run = await api.dataQuery.dataQueryControllerGet({ id });
      failingSince = null;
      onUpdate(run);
      if (TERMINAL_STATUSES.has(run.status)) return run;
    } catch (error) {
      // The run goes on in its job whatever happens to this page's requests:
      // keep asking through a brief outage instead of reporting it as failed.
      if (!isTransient(error)) throw error;
      failingSince ??= Date.now();
      if (Date.now() - failingSince > POLL_GRACE_MS) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** A cell as the grid shows it: numbers stay numbers, the rest becomes text. */
function cellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) &&
      value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (value instanceof Uint8Array) {
    return `0x${Array.from(value.slice(0, 32), (b) => b.toString(16).padStart(2, "0")).join("")}${value.length > 32 ? "…" : ""}`;
  }
  const candidate = value as {
    toJSON?: () => unknown;
    toString?: () => string;
  };
  if (typeof candidate.toJSON === "function") {
    try {
      return JSON.stringify(candidate.toJSON(), (_key, v: unknown) =>
        typeof v === "bigint" ? v.toString() : v,
      );
    } catch {
      /* fall through */
    }
  }
  return String(value);
}

/** The rows of a finished run, decoded from Arrow. */
export async function fetchRows(run: QueryRun): Promise<QueryRows> {
  const response = await api.dataQuery.dataQueryControllerResultRaw({
    id: run.id,
  });
  const buffer = new Uint8Array(await response.raw.arrayBuffer());
  const { tableFromIPC, DataType } = await import("apache-arrow");
  const table = tableFromIPC(buffer);
  const columns = table.schema.fields.map((field) => ({
    name: field.name,
    type:
      run.columns?.find((column) => column.name === field.name)?.type ??
      String(field.type),
  }));
  // The Arrow reader hands dates and timestamps back as epoch milliseconds:
  // show them as dates, the way the source has them.
  const kinds = table.schema.fields.map((field) =>
    DataType.isDate(field.type)
      ? "date"
      : DataType.isTimestamp(field.type)
        ? "timestamp"
        : "value",
  );
  const vectors = table.schema.fields.map((_, index) =>
    table.getChildAt(index),
  );
  const rows: unknown[][] = [];
  for (let row = 0; row < table.numRows; row++) {
    rows.push(
      vectors.map((vector, index) => {
        const value: unknown = vector?.get(row);
        const kind = kinds[index];
        if (value !== null && value !== undefined && kind !== "value") {
          const ms = typeof value === "bigint" ? Number(value) : value;
          if (typeof ms === "number" || ms instanceof Date) {
            const iso = new Date(ms).toISOString();
            return kind === "date" ? iso.slice(0, 10) : iso;
          }
        }
        return cellValue(value);
      }),
    );
  }
  return { columns, rows };
}

/** The message a refused or failed run shows, from its error or its status. */
export function runErrorMessage(run: QueryRun): string | null {
  if (run.status === "SUCCESS") return null;
  return run.error?.message ?? null;
}

/** The text of an API error thrown by the generated client. */
export async function apiErrorMessage(error: unknown): Promise<string> {
  const response = (error as { response?: Response })?.response;
  if (response) {
    try {
      const body = (await response.clone().json()) as { message?: unknown };
      if (typeof body.message === "string") return body.message;
    } catch {
      /* not JSON */
    }
    return `${response.status} ${response.statusText}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The table of a catalog that an asset is, if it is one. */
export function catalogTableFor(
  catalog: QueryCatalog | null,
  assetId: string,
): QueryCatalogTable | null {
  for (const source of catalog?.sources ?? []) {
    const table = source.tables.find((t) => t.assetId === assetId);
    if (table) return table;
  }
  return null;
}

/**
 * The catalog narrowed to one source: a source's Data tab lists, and its
 * editor completes, only that source's tables.
 */
export function catalogOfSource(
  catalog: QueryCatalog,
  sourceId: string,
): QueryCatalog {
  return {
    ...catalog,
    sources: (catalog.sources ?? []).filter((source) => source.id === sourceId),
  };
}
