import { createStore } from "zustand/vanilla";
import {
  DATA_REQUEST_MAX_JOINS,
  DATA_REQUEST_MAX_TABLES,
  DataRequestSpecSchema,
  EMPTY_DATA_REQUEST_SPEC,
  generateRequestSql,
  type DataRequestFilter,
  type DataRequestJoin,
  type DataRequestJoinEndpoint,
  type DataRequestJoinType,
  type DataRequestPin,
  type DataRequestSpec,
  type DataRequestTable,
  type RequestSqlDiagnostic,
  type SchemaTableColor,
} from "@workspace/schemas/data-request";
import type {
  DataRequestCheckResultDto,
  DataRequestDescribeResultDto,
  DataRequestDetailDto,
  QueryCatalogDto,
  QueryCatalogTableDto,
} from "@workspace/api-client";
import type { JoinPatch } from "@/components/visual-schema/types";
import {
  addFilterInSpec,
  addJoinsToSpec,
  addTablesToSpec,
  buildCatalogLookup as buildSharedCatalogLookup,
  makeSpecId,
  moveTablesInSpec,
  removeFilterInSpec,
  removeJoinFromSpec,
  removeTableJoinsFromSpec,
  removeTablesFromSpec,
  renameTableAliasInSpec,
  resizeTableInSpec,
  sanitizeSpecAgainstCatalog,
  setTableColorInSpec,
  setTableColumnsInSpec,
  setTablesCollapsedInSpec,
  setTablesColumnsInSpec,
  setTablesHiddenInSpec,
  toggleColumnInSpec,
  toggleTableCollapsedInSpec,
  updateJoinInSpec,
  VisualSchemaSpecSchema,
} from "@/components/visual-schema/lib/spec-reducer";

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

export function buildCatalogLookup(catalog: QueryCatalogDto | null) {
  return buildSharedCatalogLookup(catalog);
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
  setTablesCollapsed: (tableIds: string[], collapsed: boolean) => void;
  setTablesHidden: (tableIds: string[], hidden: boolean) => void;
  renameTableAlias: (tableId: string, alias: string) => boolean;
  toggleColumn: (tableId: string, column: string) => void;
  setTableColumns: (tableId: string, columns: string[]) => void;
  setTablesColumns: (updates: Record<string, string[]>) => void;
  addFilter: (tableId: string, filter: DataRequestFilter) => void;
  removeFilter: (tableId: string, indexOrId: number | string) => void;
  addJoin: (
    left: DataRequestJoinEndpoint,
    right: DataRequestJoinEndpoint,
    typeOrOptions?: DataRequestJoinType | JoinPatch,
  ) => DataRequestJoin | null;
  addJoins: (
    batch: Array<{
      left: DataRequestJoinEndpoint;
      right: DataRequestJoinEndpoint;
      options?: JoinPatch;
    }>,
  ) => DataRequestJoin[];
  updateJoin: (joinId: string, patch: JoinPatch) => void;
  toggleJoinType: (joinId: string) => void;
  removeJoin: (joinId: string) => void;
  removeTableJoins: (tableIds: string[]) => void;
  clearCanvas: () => void;
  importSpec: (nextSpec: DataRequestSpec) => DataRequestSpec | null;
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

export function createRequestStore(caseId: string, deps: RequestStoreDeps) {
  const clientId = makeSpecId("tab");
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
        const res = addTablesToSpec(get().spec, tables, {
          maxTables: DATA_REQUEST_MAX_TABLES,
          positions,
          colStepX: 300,
          colStepY: 260,
        });
        if (!res) return [];
        commitSpec(res.spec);
        return res.created;
      },

      removeTable: (tableId) => {
        get().removeTables([tableId]);
      },

      removeTables: (tableIds) => {
        const s = get();
        const nextSpec = removeTablesFromSpec(s.spec, tableIds, {
          unanchorPins: true,
        });
        if (!nextSpec) return;
        commitSpec(nextSpec);
        if (s.selectedTableId && tableIds.includes(s.selectedTableId)) {
          set({ selectedTableId: null });
        }
      },

      moveTable: (tableId, x, y) => {
        get().moveTables({ [tableId]: { x, y } });
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

      renameTableAlias: (tableId, alias) => {
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

      addJoin: (left, right, typeOrOptions = "INNER") => {
        const options: JoinPatch =
          typeof typeOrOptions === "string"
            ? { type: typeOrOptions }
            : typeOrOptions;
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

      toggleJoinType: (joinId) => {
        const target = get().spec.joins.find((j) => j.id === joinId);
        if (!target) return;
        commitSpec(
          updateJoinInSpec(get().spec, joinId, {
            type: target.type === "INNER" ? "LEFT" : "INNER",
          }),
        );
      },

      removeJoin: (joinId) => {
        commitSpec(removeJoinFromSpec(get().spec, joinId));
      },

      removeTableJoins: (tableIds) => {
        const next = removeTableJoinsFromSpec(get().spec, tableIds);
        if (next) commitSpec(next);
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
        const parsed = VisualSchemaSpecSchema.safeParse(nextSpec);
        if (!parsed.success) return null;
        const sanitized = sanitizeSpecAgainstCatalog(parsed.data, s.catalog, {
          dropMissingTables: false,
          maxTables: DATA_REQUEST_MAX_TABLES,
          maxJoins: DATA_REQUEST_MAX_JOINS,
          preservePins: s.spec.pins,
        });
        commitSpec(sanitized);
        return sanitized;
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
