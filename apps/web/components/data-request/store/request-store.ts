import { createStore } from "zustand/vanilla";
import {
  DATA_REQUEST_MAX_TABLES,
  DataRequestSpecSchema,
  EMPTY_DATA_REQUEST_SPEC,
  generateRequestSql,
  suggestTableAlias,
  type DataRequestFilter,
  type DataRequestJoin,
  type DataRequestJoinEndpoint,
  type DataRequestJoinType,
  type DataRequestPin,
  type DataRequestSpec,
  type DataRequestTable,
  type RequestSqlDiagnostic,
  type RequestTableMeta,
} from "@workspace/schemas/data-request";
import type {
  DataRequestCheckResultDto,
  DataRequestDescribeResultDto,
  DataRequestDetailDto,
  QueryCatalogDto,
  QueryCatalogTableDto,
} from "@workspace/api-client";

export const SPEC_SAVE_DEBOUNCE_MS = 800;
export const CHECK_DEBOUNCE_MS = 600;
export const DESCRIBE_SQL_EDIT_DEBOUNCE_MS = 2000;
export const GRID_SNAP = 20;
const MAX_HISTORY = 50;

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SNAP) * GRID_SNAP;
}

export function isConflictError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };
  return (
    e.status === 409 ||
    e.statusCode === 409 ||
    e.response?.status === 409
  );
}

export function parseSpec(raw: unknown): DataRequestSpec {
  const res = DataRequestSpecSchema.safeParse(raw);
  return res.success ? res.data : EMPTY_DATA_REQUEST_SPEC;
}

export function buildCatalogLookup(
  catalog: QueryCatalogDto | null,
): Map<string, RequestTableMeta> | undefined {
  if (!catalog) return undefined;
  const map = new Map<string, RequestTableMeta>();
  for (const source of catalog.sources) {
    for (const table of source.tables) {
      map.set(table.assetId, {
        sqlName: table.sqlName,
        exists: true,
        columns: table.columns.map((c) => ({ name: c.name, type: c.type })),
      });
    }
  }
  return map;
}

export interface RequestStoreDeps {
  saveSpec: (
    caseId: string,
    payload: { spec: DataRequestSpec; baseVersion: number; clientId: string },
  ) => Promise<DataRequestDetailDto>;
  saveSql: (
    caseId: string,
    payload: {
      sql?: string;
      regenerate?: boolean;
      baseVersion: number;
      clientId: string;
    },
  ) => Promise<DataRequestDetailDto>;
  check: (caseId: string) => Promise<DataRequestCheckResultDto>;
  describe: (caseId: string) => Promise<DataRequestDescribeResultDto>;
  reload: (caseId: string) => Promise<DataRequestDetailDto>;
  onConflict?: () => void;
  onError?: (error: unknown) => void;
  saveDebounceMs?: number;
  checkDebounceMs?: number;
  describeDebounceMs?: number;
}

export interface RequestStoreState {
  caseId: string;
  clientId: string;
  request: DataRequestDetailDto | null;
  catalog: QueryCatalogDto | null;
  spec: DataRequestSpec;
  specVersion: number;
  draftSql: string;
  sqlEdited: boolean;
  diagnostics: RequestSqlDiagnostic[];
  checkResult: DataRequestCheckResultDto | null;
  checking: boolean;
  describeResult: DataRequestDescribeResultDto | null;
  describing: boolean;
  saving: boolean;
  dirty: boolean;
  saveError: string | null;
  conflictCount: number;
  undoStack: DataRequestSpec[];
  redoStack: DataRequestSpec[];
  presence: string[];
  selectedTableId: string | null;
  openCommentThreadId: string | null;
  commentToolActive: boolean;
  deliverPulse: number;

  hydrate: (detail: DataRequestDetailDto, catalog?: QueryCatalogDto | null) => void;
  setCatalog: (catalog: QueryCatalogDto | null) => void;
  setPresence: (others: string[]) => void;
  setSelectedTableId: (id: string | null) => void;
  setOpenCommentThreadId: (threadId: string | null) => void;
  setCommentToolActive: (active: boolean) => void;
  triggerDeliverPulse: () => void;

  addTable: (
    table: Pick<QueryCatalogTableDto, "assetId" | "sqlName" | "columns">,
    position?: { x: number; y: number },
  ) => DataRequestTable | null;
  removeTable: (tableId: string) => void;
  moveTable: (tableId: string, x: number, y: number) => void;
  toggleColumn: (tableId: string, column: string) => void;
  setTableColumns: (tableId: string, columns: string[]) => void;
  addFilter: (tableId: string, filter: DataRequestFilter) => void;
  removeFilter: (tableId: string, indexOrId: number | string) => void;
  addJoin: (
    left: DataRequestJoinEndpoint,
    right: DataRequestJoinEndpoint,
    type?: DataRequestJoinType,
  ) => DataRequestJoin | null;
  toggleJoinType: (joinId: string) => void;
  removeJoin: (joinId: string) => void;
  appendPin: (pin: DataRequestPin, nextVersion: number) => void;

  undo: () => void;
  redo: () => void;
  flushSave: () => Promise<void>;
  updateManualSql: (sql: string) => Promise<void>;
  regenerateSqlFromCanvas: () => Promise<void>;
  runCheck: () => Promise<void>;
  runDescribe: () => Promise<void>;
  reloadFromServer: () => Promise<void>;
  dispose: () => void;
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createRequestStore(caseId: string, deps: RequestStoreDeps) {
  const clientId = makeId("tab");
  const saveMs = deps.saveDebounceMs ?? SPEC_SAVE_DEBOUNCE_MS;
  const checkMs = deps.checkDebounceMs ?? CHECK_DEBOUNCE_MS;
  const describeMs = deps.describeDebounceMs ?? DESCRIBE_SQL_EDIT_DEBOUNCE_MS;

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  let describeTimer: ReturnType<typeof setTimeout> | null = null;
  let saveInFlight = false;
  let pendingResave = false;

  const clearTimers = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (checkTimer) {
      clearTimeout(checkTimer);
      checkTimer = null;
    }
    if (describeTimer) {
      clearTimeout(describeTimer);
      describeTimer = null;
    }
  };

  const store = createStore<RequestStoreState>((set, get) => {
    const recomputeLocal = (
      spec: DataRequestSpec,
      sqlEdited: boolean,
      currentSql: string,
      catalog: QueryCatalogDto | null,
    ) => {
      const lookup = buildCatalogLookup(catalog);
      const generated = generateRequestSql(spec, lookup);
      return {
        diagnostics: sqlEdited ? [] : generated.diagnostics,
        draftSql: sqlEdited ? currentSql : generated.sql,
      };
    };

    const scheduleCheck = () => {
      if (checkTimer) clearTimeout(checkTimer);
      checkTimer = setTimeout(() => {
        checkTimer = null;
        void get().runCheck();
      }, checkMs);
    };

    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void get().flushSave();
      }, saveMs);
    };

    const commitSpec = (nextSpec: DataRequestSpec, recordUndo = true) => {
      const s = get();
      const computed = recomputeLocal(
        nextSpec,
        s.sqlEdited,
        s.draftSql,
        s.catalog,
      );
      const undoStack = recordUndo
        ? [...s.undoStack.slice(-(MAX_HISTORY - 1)), s.spec]
        : s.undoStack;
      set({
        spec: nextSpec,
        draftSql: computed.draftSql,
        diagnostics: computed.diagnostics,
        undoStack,
        redoStack: recordUndo ? [] : s.redoStack,
        dirty: true,
        saveError: null,
      });
      scheduleSave();
      scheduleCheck();
    };

    return {
      caseId,
      clientId,
      request: null,
      catalog: null,
      spec: EMPTY_DATA_REQUEST_SPEC,
      specVersion: 1,
      draftSql: "",
      sqlEdited: false,
      diagnostics: [],
      checkResult: null,
      checking: false,
      describeResult: null,
      describing: false,
      saving: false,
      dirty: false,
      saveError: null,
      conflictCount: 0,
      undoStack: [],
      redoStack: [],
      presence: [],
      selectedTableId: null,
      openCommentThreadId: null,
      commentToolActive: false,
      deliverPulse: 0,

      hydrate: (detail, catalog) => {
        const nextCatalog = catalog !== undefined ? catalog : get().catalog;
        const parsed = parseSpec(detail.spec);
        const computed = recomputeLocal(
          parsed,
          detail.sqlEdited,
          detail.draftSql,
          nextCatalog,
        );
        set({
          request: detail,
          catalog: nextCatalog,
          spec: parsed,
          specVersion: detail.specVersion,
          draftSql: detail.sqlEdited ? detail.draftSql : computed.draftSql || detail.draftSql,
          sqlEdited: detail.sqlEdited,
          diagnostics: computed.diagnostics,
          dirty: false,
          saveError: null,
        });
      },

      setCatalog: (catalog) => {
        const s = get();
        const computed = recomputeLocal(
          s.spec,
          s.sqlEdited,
          s.draftSql,
          catalog,
        );
        set({
          catalog,
          diagnostics: computed.diagnostics,
          draftSql: s.sqlEdited ? s.draftSql : computed.draftSql || s.draftSql,
        });
      },

      setPresence: (others) => set({ presence: others }),
      setSelectedTableId: (id) => set({ selectedTableId: id }),
      setOpenCommentThreadId: (threadId) => set({ openCommentThreadId: threadId }),
      setCommentToolActive: (active) => set({ commentToolActive: active }),
      triggerDeliverPulse: () => set((s) => ({ deliverPulse: s.deliverPulse + 1 })),

      addTable: (table, position) => {
        const s = get();
        if (s.spec.tables.length >= DATA_REQUEST_MAX_TABLES) return null;
        const taken = new Set(s.spec.tables.map((t) => t.alias.toLowerCase()));
        const alias = suggestTableAlias(table.sqlName, taken);
        const defaultX = snapToGrid(
          position?.x ?? 60 + (s.spec.tables.length % 3) * 300,
        );
        const defaultY = snapToGrid(
          position?.y ?? 60 + Math.floor(s.spec.tables.length / 3) * 260,
        );
        const initialKeep = table.columns.slice(0, 8).map((c) => c.name);
        const entry: DataRequestTable = {
          id: makeId("tbl"),
          assetId: table.assetId,
          sqlName: table.sqlName,
          alias,
          x: defaultX,
          y: defaultY,
          keep: initialKeep,
          filters: [],
        };
        commitSpec({
          ...s.spec,
          tables: [...s.spec.tables, entry],
        });
        return entry;
      },

      removeTable: (tableId) => {
        const s = get();
        const nextSpec: DataRequestSpec = {
          tables: s.spec.tables.filter((t) => t.id !== tableId),
          joins: s.spec.joins.filter(
            (j) => j.left.tableId !== tableId && j.right.tableId !== tableId,
          ),
          pins: s.spec.pins.map((p) =>
            p.anchor?.tableId === tableId ? { ...p, anchor: null } : p,
          ),
        };
        commitSpec(nextSpec);
        if (s.selectedTableId === tableId) set({ selectedTableId: null });
      },

      moveTable: (tableId, x, y) => {
        const s = get();
        const sx = snapToGrid(x);
        const sy = snapToGrid(y);
        const current = s.spec.tables.find((t) => t.id === tableId);
        if (!current || (current.x === sx && current.y === sy)) return;
        const nextSpec: DataRequestSpec = {
          ...s.spec,
          tables: s.spec.tables.map((t) =>
            t.id === tableId ? { ...t, x: sx, y: sy } : t,
          ),
        };
        commitSpec(nextSpec);
      },

      toggleColumn: (tableId, column) => {
        const s = get();
        const nextSpec: DataRequestSpec = {
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
        };
        commitSpec(nextSpec);
      },

      setTableColumns: (tableId, columns) => {
        const s = get();
        const nextSpec: DataRequestSpec = {
          ...s.spec,
          tables: s.spec.tables.map((t) =>
            t.id === tableId ? { ...t, keep: [...columns] } : t,
          ),
        };
        commitSpec(nextSpec);
      },

      addFilter: (tableId, filter) => {
        const s = get();
        const withId: DataRequestFilter = {
          ...filter,
          id: filter.id ?? makeId("flt"),
        };
        const nextSpec: DataRequestSpec = {
          ...s.spec,
          tables: s.spec.tables.map((t) =>
            t.id === tableId
              ? { ...t, filters: [...t.filters, withId] }
              : t,
          ),
        };
        commitSpec(nextSpec);
      },

      removeFilter: (tableId, indexOrId) => {
        const s = get();
        const nextSpec: DataRequestSpec = {
          ...s.spec,
          tables: s.spec.tables.map((t) => {
            if (t.id !== tableId) return t;
            const filters =
              typeof indexOrId === "number"
                ? t.filters.filter((_, i) => i !== indexOrId)
                : t.filters.filter((f) => f.id !== indexOrId);
            return { ...t, filters };
          }),
        };
        commitSpec(nextSpec);
      },

      addJoin: (left, right, type = "INNER") => {
        const s = get();
        if (left.tableId === right.tableId) return null;
        const duplicate = s.spec.joins.some(
          (j) =>
            (j.left.tableId === left.tableId &&
              j.left.column === left.column &&
              j.right.tableId === right.tableId &&
              j.right.column === right.column) ||
            (j.left.tableId === right.tableId &&
              j.left.column === right.column &&
              j.right.tableId === left.tableId &&
              j.right.column === left.column),
        );
        if (duplicate) return null;
        const join: DataRequestJoin = {
          id: makeId("jn"),
          left,
          right,
          type,
        };
        commitSpec({
          ...s.spec,
          joins: [...s.spec.joins, join],
        });
        return join;
      },

      toggleJoinType: (joinId) => {
        const s = get();
        const nextSpec: DataRequestSpec = {
          ...s.spec,
          joins: s.spec.joins.map((j) =>
            j.id === joinId
              ? { ...j, type: j.type === "INNER" ? "LEFT" : "INNER" }
              : j,
          ),
        };
        commitSpec(nextSpec);
      },

      removeJoin: (joinId) => {
        const s = get();
        commitSpec({
          ...s.spec,
          joins: s.spec.joins.filter((j) => j.id !== joinId),
        });
      },

      appendPin: (pin, nextVersion) => {
        set((s) => ({
          spec: { ...s.spec, pins: [...s.spec.pins, pin] },
          specVersion: Math.max(s.specVersion, nextVersion),
        }));
      },

      undo: () => {
        const s = get();
        if (s.undoStack.length === 0) return;
        const previous = s.undoStack[s.undoStack.length - 1]!;
        const computed = recomputeLocal(
          previous,
          s.sqlEdited,
          s.draftSql,
          s.catalog,
        );
        set({
          spec: previous,
          draftSql: computed.draftSql,
          diagnostics: computed.diagnostics,
          undoStack: s.undoStack.slice(0, -1),
          redoStack: [...s.redoStack.slice(-(MAX_HISTORY - 1)), s.spec],
          dirty: true,
        });
        scheduleSave();
        scheduleCheck();
      },

      redo: () => {
        const s = get();
        if (s.redoStack.length === 0) return;
        const next = s.redoStack[s.redoStack.length - 1]!;
        const computed = recomputeLocal(
          next,
          s.sqlEdited,
          s.draftSql,
          s.catalog,
        );
        set({
          spec: next,
          draftSql: computed.draftSql,
          diagnostics: computed.diagnostics,
          undoStack: [...s.undoStack.slice(-(MAX_HISTORY - 1)), s.spec],
          redoStack: s.redoStack.slice(0, -1),
          dirty: true,
        });
        scheduleSave();
        scheduleCheck();
      },

      flushSave: async () => {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        const s = get();
        if (!s.dirty) return;
        if (saveInFlight) {
          pendingResave = true;
          return;
        }
        saveInFlight = true;
        set({ saving: true, saveError: null });
        const sentSpec = s.spec;
        const baseVersion = s.specVersion;
        try {
          const updated = await deps.saveSpec(s.caseId, {
            spec: sentSpec,
            baseVersion,
            clientId,
          });
          const latest = get();
          // Preserve newer local edits if user kept editing during flight
          const unchanged = latest.spec === sentSpec;
          set({
            request: updated,
            specVersion: updated.specVersion,
            draftSql: unchanged
              ? updated.draftSql
              : latest.draftSql,
            sqlEdited: updated.sqlEdited,
            saving: false,
            dirty: !unchanged,
          });
        } catch (error) {
          if (isConflictError(error)) {
            set((curr) => ({
              saving: false,
              dirty: false,
              conflictCount: curr.conflictCount + 1,
            }));
            pendingResave = false;
            deps.onConflict?.();
            await get().reloadFromServer();
          } else {
            set({
              saving: false,
              saveError:
                error instanceof Error ? error.message : "Failed to save spec",
            });
            deps.onError?.(error);
          }
        } finally {
          saveInFlight = false;
          if (pendingResave) {
            pendingResave = false;
            void get().flushSave();
          }
        }
      },

      updateManualSql: async (sql) => {
        const s = get();
        if (s.dirty) await get().flushSave();
        const curr = get();
        set({ saving: true, saveError: null });
        try {
          const updated = await deps.saveSql(curr.caseId, {
            sql,
            baseVersion: curr.specVersion,
            clientId,
          });
          set({
            request: updated,
            specVersion: updated.specVersion,
            draftSql: updated.draftSql,
            sqlEdited: updated.sqlEdited,
            diagnostics: [],
            saving: false,
          });
          void get().runCheck();
          if (describeTimer) clearTimeout(describeTimer);
          describeTimer = setTimeout(() => {
            describeTimer = null;
            void get().runDescribe();
          }, describeMs);
        } catch (error) {
          if (isConflictError(error)) {
            set((c) => ({ saving: false, conflictCount: c.conflictCount + 1 }));
            deps.onConflict?.();
            await get().reloadFromServer();
          } else {
            set({
              saving: false,
              saveError:
                error instanceof Error ? error.message : "Failed to save SQL",
            });
            deps.onError?.(error);
          }
        }
      },

      regenerateSqlFromCanvas: async () => {
        const s = get();
        if (s.dirty) await get().flushSave();
        const curr = get();
        set({ saving: true, saveError: null });
        try {
          const updated = await deps.saveSql(curr.caseId, {
            regenerate: true,
            baseVersion: curr.specVersion,
            clientId,
          });
          get().hydrate(updated);
          set({ saving: false });
          void get().runCheck();
        } catch (error) {
          if (isConflictError(error)) {
            set((c) => ({ saving: false, conflictCount: c.conflictCount + 1 }));
            deps.onConflict?.();
            await get().reloadFromServer();
          } else {
            set({ saving: false });
            deps.onError?.(error);
          }
        }
      },

      runCheck: async () => {
        const s = get();
        if (s.dirty) await get().flushSave();
        set({ checking: true });
        try {
          const res = await deps.check(get().caseId);
          set({ checkResult: res, checking: false });
        } catch (error) {
          set({ checking: false });
          deps.onError?.(error);
        }
      },

      runDescribe: async () => {
        const s = get();
        if (s.dirty) await get().flushSave();
        set({ describing: true });
        try {
          const res = await deps.describe(get().caseId);
          set({
            describeResult: res,
            checkResult: res.check ?? get().checkResult,
            describing: false,
          });
        } catch (error) {
          set({ describing: false });
          deps.onError?.(error);
        }
      },

      reloadFromServer: async () => {
        try {
          const fresh = await deps.reload(get().caseId);
          get().hydrate(fresh);
        } catch (error) {
          deps.onError?.(error);
        }
      },

      dispose: () => {
        clearTimers();
      },
    };
  });

  return store;
}

export type RequestStoreApi = ReturnType<typeof createRequestStore>;
