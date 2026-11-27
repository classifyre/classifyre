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
  type SchemaTableColor,
} from "@workspace/schemas/data-request";
import type {
  DataRequestCheckResultDto,
  DataRequestDescribeResultDto,
  DataRequestDetailDto,
  QueryCatalogDto,
  QueryCatalogTableDto,
} from "@workspace/api-client";
import type {
  AddJoinOptions,
  JoinPatch,
} from "@/components/visual-schema/types";

const PLAIN_IDENT = /^[a-z_][a-z0-9_]*$/;

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
  addTables: (
    tables: ReadonlyArray<
      Pick<QueryCatalogTableDto, "assetId" | "sqlName" | "columns">
    >,
    positions?: ReadonlyArray<{ x: number; y: number }>,
  ) => DataRequestTable[];
  removeTable: (tableId: string) => void;
  removeTables: (tableIds: string[]) => void;
  moveTable: (tableId: string, x: number, y: number) => void;
  moveTables: (updates: Record<string, { x: number; y: number }>) => void;
  resizeTable: (tableId: string, height: number) => void;
  setTableColor: (
    tableIds: string[],
    color: SchemaTableColor | undefined,
  ) => void;
  toggleTableCollapsed: (tableId: string) => void;
  setTablesHidden: (tableIds: string[], hidden: boolean) => void;
  renameTableAlias: (tableId: string, alias: string) => boolean;
  toggleColumn: (tableId: string, column: string) => void;
  setTableColumns: (tableId: string, columns: string[]) => void;
  addFilter: (tableId: string, filter: DataRequestFilter) => void;
  removeFilter: (tableId: string, indexOrId: number | string) => void;
  addJoin: (
    left: DataRequestJoinEndpoint,
    right: DataRequestJoinEndpoint,
    typeOrOptions?: DataRequestJoinType | AddJoinOptions,
  ) => DataRequestJoin | null;
  addJoins: (
    batch: Array<{
      left: DataRequestJoinEndpoint;
      right: DataRequestJoinEndpoint;
      options?: AddJoinOptions;
    }>,
  ) => DataRequestJoin[];
  updateJoin: (joinId: string, patch: JoinPatch) => void;
  toggleJoinType: (joinId: string) => void;
  removeJoin: (joinId: string) => void;
  removeTableJoins: (tableIds: string[]) => void;
  clearCanvas: () => void;
  importSpec: (nextSpec: DataRequestSpec) => void;
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

    const handleWriteFailure = async (
      error: unknown,
      fallbackMessage?: string,
      clearDirty = false,
    ) => {
      if (isConflictError(error)) {
        set((c) => ({
          saving: false,
          ...(clearDirty ? { dirty: false } : {}),
          conflictCount: c.conflictCount + 1,
        }));
        if (clearDirty) pendingResave = false;
        deps.onConflict?.();
        await get().reloadFromServer();
        return;
      }
      set({
        saving: false,
        ...(fallbackMessage
          ? {
              saveError:
                error instanceof Error ? error.message : fallbackMessage,
            }
          : {}),
      });
      deps.onError?.(error);
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
        const added = get().addTables([table], position ? [position] : undefined);
        return added[0] ?? null;
      },

      addTables: (tables, positions) => {
        const s = get();
        const remaining = Math.max(
          0,
          DATA_REQUEST_MAX_TABLES - s.spec.tables.length,
        );
        if (remaining === 0 || tables.length === 0) return [];
        const batch = tables.slice(0, remaining);
        const taken = new Set(s.spec.tables.map((t) => t.alias.toLowerCase()));
        const nextTables = [...s.spec.tables];
        const created: DataRequestTable[] = [];

        batch.forEach((table, idx) => {
          const alias = suggestTableAlias(table.sqlName, taken);
          taken.add(alias.toLowerCase());
          const pos = positions?.[idx];
          const count = nextTables.length;
          const entry: DataRequestTable = {
            id: makeId("tbl"),
            assetId: table.assetId,
            sqlName: table.sqlName,
            alias,
            x: snapToGrid(pos?.x ?? 60 + (count % 3) * 300),
            y: snapToGrid(pos?.y ?? 60 + Math.floor(count / 3) * 260),
            keep: table.columns.slice(0, 8).map((c) => c.name),
            filters: [],
          };
          nextTables.push(entry);
          created.push(entry);
        });

        commitSpec({
          ...s.spec,
          tables: nextTables,
        });
        return created;
      },

      removeTable: (tableId) => {
        get().removeTables([tableId]);
      },

      removeTables: (tableIds) => {
        const s = get();
        const ids = new Set(tableIds);
        if (ids.size === 0) return;
        const nextSpec: DataRequestSpec = {
          ...s.spec,
          tables: s.spec.tables.filter((t) => !ids.has(t.id)),
          joins: s.spec.joins.filter(
            (j) => !ids.has(j.left.tableId) && !ids.has(j.right.tableId),
          ),
          pins: s.spec.pins.map((p) =>
            p.anchor?.tableId && ids.has(p.anchor.tableId)
              ? { ...p, anchor: null }
              : p,
          ),
        };
        commitSpec(nextSpec);
        if (s.selectedTableId && ids.has(s.selectedTableId)) {
          set({ selectedTableId: null });
        }
      },

      moveTable: (tableId, x, y) => {
        get().moveTables({ [tableId]: { x, y } });
      },

      moveTables: (updates) => {
        const s = get();
        let changed = false;
        const nextTables = s.spec.tables.map((t) => {
          const u = updates[t.id];
          if (!u) return t;
          const sx = snapToGrid(u.x);
          const sy = snapToGrid(u.y);
          if (t.x === sx && t.y === sy) return t;
          changed = true;
          return { ...t, x: sx, y: sy };
        });
        if (!changed) return;
        commitSpec({
          ...s.spec,
          tables: nextTables,
        });
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
        if (ids.size === 0) return;
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
        if (ids.size === 0) return;
        commitSpec({
          ...s.spec,
          tables: s.spec.tables.map((t) =>
            ids.has(t.id) ? { ...t, hidden } : t,
          ),
        });
      },

      renameTableAlias: (tableId, alias) => {
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

      addJoin: (left, right, typeOrOptions = "INNER") => {
        const options: AddJoinOptions =
          typeof typeOrOptions === "string"
            ? { type: typeOrOptions }
            : typeOrOptions;
        const created = get().addJoins([{ left, right, options }]);
        return created[0] ?? null;
      },

      addJoins: (batch) => {
        const s = get();
        const nextJoins = [...s.spec.joins];
        const created: DataRequestJoin[] = [];

        for (const item of batch) {
          if (item.left.tableId === item.right.tableId) continue;
          const duplicate = nextJoins.some(
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
          if (duplicate) continue;
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
        commitSpec({
          ...s.spec,
          joins: nextJoins,
        });
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

      removeTableJoins: (tableIds) => {
        const s = get();
        const ids = new Set(tableIds);
        const nextJoins = s.spec.joins.filter(
          (j) => !ids.has(j.left.tableId) && !ids.has(j.right.tableId),
        );
        if (nextJoins.length === s.spec.joins.length) return;
        commitSpec({
          ...s.spec,
          joins: nextJoins,
        });
      },

      clearCanvas: () => {
        const s = get();
        if (s.spec.tables.length === 0 && s.spec.joins.length === 0) return;
        commitSpec({
          ...s.spec,
          tables: [],
          joins: [],
          pins: s.spec.pins.map((p) => ({ ...p, anchor: null })),
        });
      },

      importSpec: (nextSpec) => {
        const s = get();
        const parsed = DataRequestSpecSchema.safeParse(nextSpec);
        if (!parsed.success) return;
        const cappedTables = parsed.data.tables.slice(0, DATA_REQUEST_MAX_TABLES);
        // Security: if catalog is loaded, strip columns/filters/joins referencing
        // columns not visible to the caller (e.g. governance-hidden columns).
        const catalogByAsset = new Map<string, Set<string>>();
        if (s.catalog) {
          for (const src of s.catalog.sources) {
            for (const tbl of src.tables) {
              catalogByAsset.set(
                tbl.assetId,
                new Set(tbl.columns.map((c) => c.name.toLowerCase())),
              );
            }
          }
        }
        const validTables = cappedTables.map((tbl) => {
          const cols = catalogByAsset.get(tbl.assetId);
          if (!cols) return tbl;
          return {
            ...tbl,
            keep: tbl.keep.filter((c) => cols.has(c.toLowerCase())),
            filters: tbl.filters.filter((f) => cols.has(f.column.toLowerCase())),
          };
        });
        const tableIds = new Set(validTables.map((t) => t.id));
        const validJoins = parsed.data.joins.filter((j) => {
          if (!tableIds.has(j.left.tableId) || !tableIds.has(j.right.tableId)) {
            return false;
          }
          const leftTbl = validTables.find((t) => t.id === j.left.tableId);
          const rightTbl = validTables.find((t) => t.id === j.right.tableId);
          const lCols = leftTbl ? catalogByAsset.get(leftTbl.assetId) : undefined;
          const rCols = rightTbl ? catalogByAsset.get(rightTbl.assetId) : undefined;
          if (lCols && !lCols.has(j.left.column.toLowerCase())) return false;
          if (rCols && !rCols.has(j.right.column.toLowerCase())) return false;
          return true;
        });
        // Preserve server-managed comment pins (unanchoring those whose table changed)
        const preservedPins = s.spec.pins.map((p) =>
          p.anchor?.tableId && !tableIds.has(p.anchor.tableId)
            ? { ...p, anchor: null }
            : p,
        );
        commitSpec({
          tables: validTables,
          joins: validJoins,
          pins: preservedPins,
          ...(parsed.data.groups ? { groups: parsed.data.groups } : {}),
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
          await handleWriteFailure(error, "Failed to save spec", true);
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
          await handleWriteFailure(error, "Failed to save SQL");
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
          await handleWriteFailure(error);
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
