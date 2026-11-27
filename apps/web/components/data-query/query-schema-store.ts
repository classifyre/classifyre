import { createStore } from "zustand/vanilla";
import {
  DATA_REQUEST_MAX_TABLES,
  DataRequestSpecSchema,
  EMPTY_DATA_REQUEST_SPEC,
  generateRequestSql,
  type DataRequestFilter,
  type DataRequestJoin,
  type DataRequestJoinEndpoint,
  type DataRequestSpec,
  type DataRequestTable,
  type RequestSqlDiagnostic,
  type SchemaTableColor,
} from "@workspace/schemas/data-request";
import type { QueryCatalog, QueryCatalogTable } from "@/lib/data-query";
import type { JoinPatch } from "@/components/visual-schema/types";
import {
  addFilterInSpec,
  addJoinsToSpec,
  addTablesToSpec,
  buildCatalogLookup,
  makeSpecId,
  moveTablesInSpec,
  removeFilterInSpec,
  removeJoinFromSpec,
  removeTableJoinsFromSpec,
  removeTablesFromSpec,
  renameTableAliasInSpec,
  resizeTableInSpec,
  sanitizeSpecAgainstCatalog as sanitizeSpec,
  setTableColorInSpec,
  setTableColumnsInSpec,
  setTablesCollapsedInSpec,
  setTablesColumnsInSpec,
  setTablesHiddenInSpec,
  toggleColumnInSpec,
  toggleTableCollapsedInSpec,
  updateJoinInSpec,
  VISUAL_SCHEMA_MAX_JOINS,
  VISUAL_SCHEMA_MAX_TABLES,
  VisualSchemaSpecSchema,
} from "@/components/visual-schema/lib/spec-reducer";

export const QUERY_SCHEMA_MAX_TABLES = VISUAL_SCHEMA_MAX_TABLES;
export const QUERY_SCHEMA_AUTO_PLACE_THRESHOLD = 25;
const MAX_HISTORY = 50;

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
  return sanitizeSpec(spec, catalog, { dropMissingTables: true });
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
  setTablesCollapsed: (tableIds: string[], collapsed: boolean) => void;
  setTablesHidden: (tableIds: string[], hidden: boolean) => void;
  renameAlias: (tableId: string, alias: string) => boolean;
  toggleColumn: (tableId: string, column: string) => void;
  setTableColumns: (tableId: string, columns: string[]) => void;
  setTablesColumns: (updates: Record<string, string[]>) => void;
  addFilter: (tableId: string, filter: DataRequestFilter) => void;
  removeFilter: (tableId: string, indexOrId: number | string) => void;
  addJoin: (
    left: DataRequestJoinEndpoint,
    right: DataRequestJoinEndpoint,
    options?: JoinPatch,
  ) => DataRequestJoin | null;
  addJoins: (
    joins: Array<{
      left: DataRequestJoinEndpoint;
      right: DataRequestJoinEndpoint;
      options?: JoinPatch;
    }>,
  ) => DataRequestJoin[];
  updateJoin: (joinId: string, patch: JoinPatch) => void;
  removeJoin: (joinId: string) => void;
  removeTableJoins: (tableIds: string[]) => void;
  applyLayout: (positions: Record<string, { x: number; y: number }>) => void;
  clearCanvas: () => void;
  importSpec: (nextSpec: DataRequestSpec) => DataRequestSpec | null;
  undo: () => void;
  redo: () => void;
}

function loadFromStorage(storageKey: string | null): DataRequestSpec | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = VisualSchemaSpecSchema.safeParse(JSON.parse(raw));
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
    buildCatalogLookup(initialCatalog),
    { maxTables: QUERY_SCHEMA_MAX_TABLES },
  );

  return createStore<QuerySchemaState>((set, get) => {
    const commitSpec = (nextSpec: DataRequestSpec, recordUndo = true) => {
      const s = get();
      const gen = generateRequestSql(nextSpec, buildCatalogLookup(s.catalog), {
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
        const gen = generateRequestSql(sanitized, buildCatalogLookup(catalog), {
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
        const res = addTablesToSpec(get().spec, tables, {
          maxTables: QUERY_SCHEMA_MAX_TABLES,
          positions,
          colStepX: 320,
          colStepY: 280,
        });
        if (!res) return [];
        commitSpec(res.spec);
        return res.created;
      },

      removeTables: (tableIds) => {
        const next = removeTablesFromSpec(get().spec, tableIds);
        if (next) commitSpec(next);
      },

      moveTables: (updates) => {
        const next = moveTablesInSpec(get().spec, updates);
        if (next) commitSpec(next);
      },

      resizeTable: (tableId, height) => {
        commitSpec(resizeTableInSpec(get().spec, tableId, height));
      },

      setTableColor: (tableIds, color) => {
        const next = setTableColorInSpec(get().spec, tableIds, color);
        if (next) commitSpec(next);
      },

      toggleTableCollapsed: (tableId) => {
        commitSpec(toggleTableCollapsedInSpec(get().spec, tableId));
      },

      setTablesCollapsed: (tableIds, collapsed) => {
        const next = setTablesCollapsedInSpec(get().spec, tableIds, collapsed);
        if (next) commitSpec(next);
      },

      setTablesHidden: (tableIds, hidden) => {
        const next = setTablesHiddenInSpec(get().spec, tableIds, hidden);
        if (next) commitSpec(next);
      },

      renameAlias: (tableId, alias) => {
        const next = renameTableAliasInSpec(get().spec, tableId, alias);
        if (!next) return false;
        commitSpec(next);
        return true;
      },

      toggleColumn: (tableId, column) => {
        commitSpec(toggleColumnInSpec(get().spec, tableId, column));
      },

      setTableColumns: (tableId, columns) => {
        commitSpec(setTableColumnsInSpec(get().spec, tableId, columns));
      },

      setTablesColumns: (updates) => {
        const next = setTablesColumnsInSpec(get().spec, updates);
        if (next) commitSpec(next);
      },

      addFilter: (tableId, filter) => {
        commitSpec(addFilterInSpec(get().spec, tableId, filter));
      },

      removeFilter: (tableId, indexOrId) => {
        commitSpec(removeFilterInSpec(get().spec, tableId, indexOrId));
      },

      addJoin: (left, right, options) => {
        const created = get().addJoins([{ left, right, options }]);
        return created[0] ?? null;
      },

      addJoins: (batch) => {
        const res = addJoinsToSpec(get().spec, batch);
        if (!res) return [];
        commitSpec(res.spec);
        return res.created;
      },

      updateJoin: (joinId, patch) => {
        commitSpec(updateJoinInSpec(get().spec, joinId, patch));
      },

      removeJoin: (joinId) => {
        commitSpec(removeJoinFromSpec(get().spec, joinId));
      },

      removeTableJoins: (tableIds) => {
        const next = removeTableJoinsFromSpec(get().spec, tableIds);
        if (next) commitSpec(next);
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
        const parsed = VisualSchemaSpecSchema.safeParse(nextSpec);
        if (!parsed.success) return null;
        const sanitized = sanitizeSpec(parsed.data, s.catalog, {
          dropMissingTables: true,
          maxTables: QUERY_SCHEMA_MAX_TABLES,
          maxJoins: VISUAL_SCHEMA_MAX_JOINS,
        });
        commitSpec(sanitized);
        return sanitized;
      },

      undo: () => {
        const s = get();
        if (s.undoStack.length === 0) return;
        const previous = s.undoStack[s.undoStack.length - 1]!;
        const gen = generateRequestSql(previous, buildCatalogLookup(s.catalog), {
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
        const gen = generateRequestSql(next, buildCatalogLookup(s.catalog), {
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
    groups: spec.groups ?? [],
  };
  const parsed = DataRequestSpecSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const token = makeSpecId("draft");
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
