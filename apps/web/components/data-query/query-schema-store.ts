import { createStore } from "zustand/vanilla";
import { z } from "zod";
import {
  DATA_REQUEST_MAX_TABLES,
  DataRequestGroupSchema,
  DataRequestJoinSchema,
  DataRequestPinSchema,
  DataRequestSpecSchema,
  DataRequestTableSchema,
  EMPTY_DATA_REQUEST_SPEC,
  generateRequestSql,
  suggestTableAlias,
  type DataRequestFilter,
  type DataRequestJoin,
  type DataRequestJoinEndpoint,
  type DataRequestSpec,
  type DataRequestTable,
  type RequestSqlDiagnostic,
  type RequestTableMeta,
  type SchemaTableColor,
} from "@workspace/schemas/data-request";
import type { QueryCatalog, QueryCatalogTable } from "@/lib/data-query";
import {
  snapSchemaCoord,
  type AddJoinOptions,
  type JoinPatch,
} from "@/components/visual-schema/types";

export const QUERY_SCHEMA_MAX_TABLES = 40;
export const QUERY_SCHEMA_AUTO_PLACE_THRESHOLD = 25;
const MAX_HISTORY = 50;
const PLAIN_IDENT = /^[a-z_][a-z0-9_]*$/;

const QuerySchemaPersistedSpecSchema = z.strictObject({
  tables: z
    .array(DataRequestTableSchema)
    .max(QUERY_SCHEMA_MAX_TABLES)
    .default([]),
  joins: z.array(DataRequestJoinSchema).max(160).default([]),
  pins: z.array(DataRequestPinSchema).max(64).default([]),
  groups: z.array(DataRequestGroupSchema).max(24).optional(),
});

function makeId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function querySchemaStorageKey(
  namespaceSlug: string,
  scopeKey: string,
  userId?: string | null,
): string {
  const userPart = userId ? `:${userId}` : "";
  return `classifyre:query-schema:${namespaceSlug}${userPart}:${scopeKey}`;
}

/**
 * Security sanitization: prune any tables no longer in the caller's catalog
 * and any columns/filters/joins referencing columns no longer visible to the
 * caller (e.g. columns hidden or restricted by governance since last visit).
 */
export function sanitizeSpecAgainstCatalog(
  spec: DataRequestSpec,
  catalog: QueryCatalog | null,
): DataRequestSpec {
  if (!catalog) return spec;
  const tablesByAsset = new Map<string, QueryCatalogTable>();
  for (const src of catalog.sources ?? []) {
    for (const tbl of src.tables) tablesByAsset.set(tbl.assetId, tbl);
  }

  const keptTables: DataRequestTable[] = [];
  const validColsByTableId = new Map<string, Set<string>>();

  for (const tbl of spec.tables) {
    const cat = tablesByAsset.get(tbl.assetId);
    if (!cat) continue;
    const validCols = new Set(cat.columns.map((c) => c.name.toLowerCase()));
    validColsByTableId.set(tbl.id, validCols);
    keptTables.push({
      ...tbl,
      sqlName: cat.sqlName,
      keep: tbl.keep.filter((c) => validCols.has(c.toLowerCase())),
      filters: tbl.filters.filter((f) => validCols.has(f.column.toLowerCase())),
    });
  }

  const keptJoins = spec.joins.filter((j) => {
    const leftCols = validColsByTableId.get(j.left.tableId);
    const rightCols = validColsByTableId.get(j.right.tableId);
    if (!leftCols || !rightCols) return false;
    return (
      leftCols.has(j.left.column.toLowerCase()) &&
      rightCols.has(j.right.column.toLowerCase())
    );
  });

  return {
    ...spec,
    tables: keptTables,
    joins: keptJoins,
  };
}

function buildLookup(
  catalog: QueryCatalog | null,
): Map<string, RequestTableMeta> | undefined {
  if (!catalog) return undefined;
  const map = new Map<string, RequestTableMeta>();
  for (const src of catalog.sources ?? []) {
    for (const tbl of src.tables) {
      map.set(tbl.assetId, {
        sqlName: tbl.sqlName,
        exists: true,
        columns: tbl.columns.map((c) => ({ name: c.name, type: c.type })),
      });
    }
  }
  return map;
}

export interface QuerySchemaState {
  catalog: QueryCatalog | null;
  spec: DataRequestSpec;
  sql: string;
  diagnostics: RequestSqlDiagnostic[];
  undoStack: DataRequestSpec[];
  redoStack: DataRequestSpec[];
  initialized: boolean;

  setCatalog: (catalog: QueryCatalog | null) => void;
  markInitialized: () => void;
  addTables: (
    tables: QueryCatalogTable[],
    positions?: Array<{ x: number; y: number }>,
  ) => DataRequestTable[];
  removeTables: (tableIds: string[]) => void;
  moveTables: (updates: Record<string, { x: number; y: number }>) => void;
  resizeTable: (tableId: string, height: number) => void;
  setTableColor: (
    tableIds: string[],
    color: SchemaTableColor | undefined,
  ) => void;
  toggleTableCollapsed: (tableId: string) => void;
  setTablesHidden: (tableIds: string[], hidden: boolean) => void;
  renameAlias: (tableId: string, alias: string) => boolean;
  toggleColumn: (tableId: string, column: string) => void;
  setTableColumns: (tableId: string, columns: string[]) => void;
  addFilter: (tableId: string, filter: DataRequestFilter) => void;
  removeFilter: (tableId: string, indexOrId: number | string) => void;
  addJoin: (
    left: DataRequestJoinEndpoint,
    right: DataRequestJoinEndpoint,
    options?: AddJoinOptions,
  ) => DataRequestJoin | null;
  addJoins: (
    joins: Array<{
      left: DataRequestJoinEndpoint;
      right: DataRequestJoinEndpoint;
      options?: AddJoinOptions;
    }>,
  ) => DataRequestJoin[];
  updateJoin: (joinId: string, patch: JoinPatch) => void;
  removeJoin: (joinId: string) => void;
  removeTableJoins: (tableIds: string[]) => void;
  applyLayout: (positions: Record<string, { x: number; y: number }>) => void;
  clearCanvas: () => void;
  importSpec: (nextSpec: DataRequestSpec) => void;
  undo: () => void;
  redo: () => void;
}

function loadFromStorage(storageKey: string | null): DataRequestSpec | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = QuerySchemaPersistedSpecSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveToStorage(storageKey: string | null, spec: DataRequestSpec): void {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(spec));
  } catch {
    // Ignore storage quota failures
  }
}

export function createQuerySchemaStore(options: {
  storageKey?: string | null;
  initialCatalog?: QueryCatalog | null;
} = {}) {
  const storageKey = options.storageKey ?? null;
  const restored = loadFromStorage(storageKey);
  const initialCatalog = options.initialCatalog ?? null;
  const startSpec = restored
    ? sanitizeSpecAgainstCatalog(restored, initialCatalog)
    : EMPTY_DATA_REQUEST_SPEC;
  const initialGen = generateRequestSql(
    startSpec,
    buildLookup(initialCatalog),
    { maxTables: QUERY_SCHEMA_MAX_TABLES },
  );

  return createStore<QuerySchemaState>((set, get) => {
    const commitSpec = (nextSpec: DataRequestSpec, recordUndo = true) => {
      const s = get();
      const gen = generateRequestSql(nextSpec, buildLookup(s.catalog), {
        maxTables: QUERY_SCHEMA_MAX_TABLES,
      });
      set({
        spec: nextSpec,
        sql: gen.sql,
        diagnostics: gen.diagnostics,
        undoStack: recordUndo
          ? [...s.undoStack.slice(-(MAX_HISTORY - 1)), s.spec]
          : s.undoStack,
        redoStack: recordUndo ? [] : s.redoStack,
      });
      saveToStorage(storageKey, nextSpec);
    };

    return {
      catalog: initialCatalog,
      spec: startSpec,
      sql: initialGen.sql,
      diagnostics: initialGen.diagnostics,
      undoStack: [],
      redoStack: [],
      initialized: restored !== null && startSpec.tables.length > 0,

      setCatalog: (catalog) => {
        const s = get();
        const sanitized = sanitizeSpecAgainstCatalog(s.spec, catalog);
        const gen = generateRequestSql(sanitized, buildLookup(catalog), {
          maxTables: QUERY_SCHEMA_MAX_TABLES,
        });
        set({
          catalog,
          spec: sanitized,
          sql: gen.sql,
          diagnostics: gen.diagnostics,
        });
        if (sanitized !== s.spec) {
          saveToStorage(storageKey, sanitized);
        }
      },

      markInitialized: () => set({ initialized: true }),

      addTables: (tables, positions) => {
        const s = get();
        const remaining = Math.max(
          0,
          QUERY_SCHEMA_MAX_TABLES - s.spec.tables.length,
        );
        if (remaining === 0 || tables.length === 0) return [];
        const batch = tables.slice(0, remaining);
        const taken = new Set(s.spec.tables.map((t) => t.alias.toLowerCase()));
        const nextTables = [...s.spec.tables];
        const created: DataRequestTable[] = [];

        batch.forEach((tbl, idx) => {
          const alias = suggestTableAlias(tbl.sqlName, taken);
          taken.add(alias.toLowerCase());
          const pos = positions?.[idx];
          const count = nextTables.length;
          const entry: DataRequestTable = {
            id: makeId("tbl"),
            assetId: tbl.assetId,
            sqlName: tbl.sqlName,
            alias,
            x: snapSchemaCoord(pos?.x ?? 60 + (count % 3) * 320),
            y: snapSchemaCoord(pos?.y ?? 60 + Math.floor(count / 3) * 280),
            keep: tbl.columns.slice(0, 8).map((c) => c.name),
            filters: [],
          };
          nextTables.push(entry);
          created.push(entry);
        });

        commitSpec({ ...s.spec, tables: nextTables });
        return created;
      },

      removeTables: (tableIds) => {
        const s = get();
        const setIds = new Set(tableIds);
        if (setIds.size === 0) return;
        commitSpec({
          ...s.spec,
          tables: s.spec.tables.filter((t) => !setIds.has(t.id)),
          joins: s.spec.joins.filter(
            (j) =>
              !setIds.has(j.left.tableId) && !setIds.has(j.right.tableId),
          ),
        });
      },

      moveTables: (updates) => {
        const s = get();
        let changed = false;
        const nextTables = s.spec.tables.map((t) => {
          const u = updates[t.id];
          if (!u) return t;
          const sx = snapSchemaCoord(u.x);
          const sy = snapSchemaCoord(u.y);
          if (t.x === sx && t.y === sy) return t;
          changed = true;
          return { ...t, x: sx, y: sy };
        });
        if (!changed) return;
        commitSpec({ ...s.spec, tables: nextTables });
      },

      resizeTable: (tableId, height) => {
        const s = get();
        const clamped = Math.max(120, Math.min(960, Math.round(height)));
        commitSpec({
          ...s.spec,
          tables: s.spec.tables.map((t) =>
            t.id === tableId ? { ...t, height: clamped } : t,
          ),
        });
      },

      setTableColor: (tableIds, color) => {
        const s = get();
        const ids = new Set(tableIds);
        commitSpec({
          ...s.spec,
          tables: s.spec.tables.map((t) => {
            if (!ids.has(t.id)) return t;
            const next = { ...t };
            if (color) next.color = color;
            else delete next.color;
            return next;
          }),
        });
      },

      toggleTableCollapsed: (tableId) => {
        const s = get();
        commitSpec({
          ...s.spec,
          tables: s.spec.tables.map((t) =>
            t.id === tableId ? { ...t, collapsed: !t.collapsed } : t,
          ),
        });
      },

      setTablesHidden: (tableIds, hidden) => {
        const s = get();
        const ids = new Set(tableIds);
        commitSpec({
          ...s.spec,
          tables: s.spec.tables.map((t) =>
            ids.has(t.id) ? { ...t, hidden } : t,
          ),
        });
      },

      renameAlias: (tableId, alias) => {
        const clean = alias.trim().toLowerCase();
        if (!PLAIN_IDENT.test(clean)) return false;
        const s = get();
        const clash = s.spec.tables.some(
          (t) => t.id !== tableId && t.alias.toLowerCase() === clean,
        );
        if (clash) return false;
        commitSpec({
          ...s.spec,
          tables: s.spec.tables.map((t) =>
            t.id === tableId ? { ...t, alias: clean } : t,
          ),
        });
        return true;
      },

      toggleColumn: (tableId, column) => {
        const s = get();
        commitSpec({
          ...s.spec,
          tables: s.spec.tables.map((t) => {
            if (t.id !== tableId) return t;
            const has = t.keep.includes(column);
            return {
              ...t,
              keep: has
                ? t.keep.filter((c) => c !== column)
                : [...t.keep, column],
            };
          }),
        });
      },

      setTableColumns: (tableId, columns) => {
        const s = get();
        commitSpec({
          ...s.spec,
          tables: s.spec.tables.map((t) =>
            t.id === tableId ? { ...t, keep: [...columns] } : t,
          ),
        });
      },

      addFilter: (tableId, filter) => {
        const s = get();
        const withId: DataRequestFilter = {
          ...filter,
          id: filter.id ?? makeId("flt"),
        };
        commitSpec({
          ...s.spec,
          tables: s.spec.tables.map((t) =>
            t.id === tableId ? { ...t, filters: [...t.filters, withId] } : t,
          ),
        });
      },

      removeFilter: (tableId, indexOrId) => {
        const s = get();
        commitSpec({
          ...s.spec,
          tables: s.spec.tables.map((t) => {
            if (t.id !== tableId) return t;
            const filters =
              typeof indexOrId === "number"
                ? t.filters.filter((_, i) => i !== indexOrId)
                : t.filters.filter((f) => f.id !== indexOrId);
            return { ...t, filters };
          }),
        });
      },

      addJoin: (left, right, options) => {
        const created = get().addJoins([{ left, right, options }]);
        return created[0] ?? null;
      },

      addJoins: (batch) => {
        const s = get();
        const nextJoins = [...s.spec.joins];
        const created: DataRequestJoin[] = [];

        for (const item of batch) {
          if (item.left.tableId === item.right.tableId) continue;
          const dup = nextJoins.some(
            (j) =>
              (j.left.tableId === item.left.tableId &&
                j.left.column === item.left.column &&
                j.right.tableId === item.right.tableId &&
                j.right.column === item.right.column) ||
              (j.left.tableId === item.right.tableId &&
                j.left.column === item.right.column &&
                j.right.tableId === item.left.tableId &&
                j.right.column === item.left.column),
          );
          if (dup) continue;
          const join: DataRequestJoin = {
            id: makeId("jn"),
            left: item.left,
            right: item.right,
            type: item.options?.type ?? "INNER",
            ...(item.options?.cardinality
              ? { cardinality: item.options.cardinality }
              : {}),
            ...(item.options?.origin ? { origin: item.options.origin } : {}),
            ...(item.options?.constraintName
              ? { constraintName: item.options.constraintName }
              : {}),
          };
          nextJoins.push(join);
          created.push(join);
        }

        if (created.length === 0) return [];
        commitSpec({ ...s.spec, joins: nextJoins });
        return created;
      },

      updateJoin: (joinId, patch) => {
        const s = get();
        commitSpec({
          ...s.spec,
          joins: s.spec.joins.map((j) => {
            if (j.id !== joinId) return j;
            const next: DataRequestJoin = { ...j, ...patch };
            if ("cardinality" in patch && patch.cardinality === undefined) {
              delete next.cardinality;
            }
            return next;
          }),
        });
      },

      removeJoin: (joinId) => {
        const s = get();
        commitSpec({
          ...s.spec,
          joins: s.spec.joins.filter((j) => j.id !== joinId),
        });
      },

      removeTableJoins: (tableIds) => {
        const s = get();
        const ids = new Set(tableIds);
        const nextJoins = s.spec.joins.filter(
          (j) => !ids.has(j.left.tableId) && !ids.has(j.right.tableId),
        );
        if (nextJoins.length === s.spec.joins.length) return;
        commitSpec({ ...s.spec, joins: nextJoins });
      },

      applyLayout: (positions) => {
        get().moveTables(positions);
      },

      clearCanvas: () => {
        const s = get();
        if (s.spec.tables.length === 0 && s.spec.joins.length === 0) return;
        commitSpec({ ...s.spec, tables: [], joins: [] });
      },

      importSpec: (nextSpec) => {
        const s = get();
        const sanitized = sanitizeSpecAgainstCatalog(nextSpec, s.catalog);
        commitSpec(sanitized);
      },

      undo: () => {
        const s = get();
        if (s.undoStack.length === 0) return;
        const previous = s.undoStack[s.undoStack.length - 1]!;
        const gen = generateRequestSql(previous, buildLookup(s.catalog), {
          maxTables: QUERY_SCHEMA_MAX_TABLES,
        });
        set({
          spec: previous,
          sql: gen.sql,
          diagnostics: gen.diagnostics,
          undoStack: s.undoStack.slice(0, -1),
          redoStack: [...s.redoStack.slice(-(MAX_HISTORY - 1)), s.spec],
        });
        saveToStorage(storageKey, previous);
      },

      redo: () => {
        const s = get();
        if (s.redoStack.length === 0) return;
        const next = s.redoStack[s.redoStack.length - 1]!;
        const gen = generateRequestSql(next, buildLookup(s.catalog), {
          maxTables: QUERY_SCHEMA_MAX_TABLES,
        });
        set({
          spec: next,
          sql: gen.sql,
          diagnostics: gen.diagnostics,
          undoStack: [...s.undoStack.slice(-(MAX_HISTORY - 1)), s.spec],
          redoStack: s.redoStack.slice(0, -1),
        });
        saveToStorage(storageKey, next);
      },
    };
  });
}

export type QuerySchemaStoreApi = ReturnType<typeof createQuerySchemaStore>;

const DRAFT_PREFIX = "classifyre:dr-draft:";

/**
 * Stash a Visual Schema spec briefly in sessionStorage for the
 * Data Query -> New Data Request handoff (?draft=<token>).
 */
export function saveDataRequestDraft(spec: DataRequestSpec): string | null {
  if (typeof window === "undefined") return null;
  const cappedTables = spec.tables.slice(0, DATA_REQUEST_MAX_TABLES);
  const keptIds = new Set(cappedTables.map((t) => t.id));
  const candidate: DataRequestSpec = {
    tables: cappedTables,
    joins: spec.joins.filter(
      (j) => keptIds.has(j.left.tableId) && keptIds.has(j.right.tableId),
    ),
    pins: [],
    ...(spec.groups?.length ? { groups: spec.groups } : {}),
  };
  const parsed = DataRequestSpecSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const token = makeId("draft");
  try {
    window.sessionStorage.setItem(
      `${DRAFT_PREFIX}${token}`,
      JSON.stringify(parsed.data),
    );
    return token;
  } catch {
    return null;
  }
}

export function loadDataRequestDraft(token: string | null): DataRequestSpec | null {
  if (!token || typeof window === "undefined") return null;
  const key = `${DRAFT_PREFIX}${token}`;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = DataRequestSpecSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearDataRequestDraft(token: string | null): void {
  if (!token || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`${DRAFT_PREFIX}${token}`);
  } catch {
    // ignore
  }
}
