"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useStore } from "zustand";
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  FilePlus2,
  Lock,
  Redo2,
  TerminalSquare,
  Undo2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { useTranslation } from "@/hooks/use-translation";
import { useMe } from "@/hooks/use-me";
import { useNamespace } from "@/components/namespace-provider";
import { useNsPath } from "@/lib/ns-path";
import {
  copyText,
  type QueryCatalog,
  type QueryCatalogSource,
  type QueryCatalogTable,
} from "@/lib/data-query";
import { findLinks } from "@/components/visual-schema/lib/find-links";
import { layoutConnectedGroups } from "@/components/visual-schema/lib/layout";
import type { VisualSchemaAdapter } from "@/components/visual-schema/types";
import { VisualSchemaWorkspace } from "@/components/visual-schema/visual-schema-workspace";
import { SqlEditor } from "./sql-editor";
import {
  createQuerySchemaStore,
  QUERY_SCHEMA_AUTO_PLACE_THRESHOLD,
  QUERY_SCHEMA_MAX_TABLES,
  querySchemaStorageKey,
  saveDataRequestDraft,
  type QuerySchemaStoreApi,
} from "./query-schema-store";

export interface QuerySchemaTabProps {
  catalog: QueryCatalog | null;
  /** Unique scope key for localStorage persistence (`workspace` or `source:<id>`). */
  scopeKey: string;
  /** When provided, auto-generates that source's tables on first empty open (up to 25). */
  autoPopulateSourceId?: string;
  onOpenInSql?: (sql: string) => void;
  onOpenTable?: (table: QueryCatalogTable, source: QueryCatalogSource) => void;
  onRefreshCatalog?: () => void;
}

export function QuerySchemaTab({
  catalog,
  scopeKey,
  autoPopulateSourceId,
  onOpenInSql,
  onOpenTable,
  onRefreshCatalog,
}: QuerySchemaTabProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();
  const { slug } = useNamespace();
  const me = useMe();
  const [copied, setCopied] = React.useState(false);

  const storageKey = React.useMemo(
    () =>
      querySchemaStorageKey(
        slug,
        scopeKey,
        me?.actor.id ?? me?.actor.displayName ?? null,
      ),
    [slug, scopeKey, me?.actor.id, me?.actor.displayName],
  );

  const [store] = React.useState<QuerySchemaStoreApi>(() =>
    createQuerySchemaStore({ storageKey, initialCatalog: catalog }),
  );

  // Sync catalog updates and sanitize hidden/revoked columns/tables
  React.useEffect(() => {
    store.getState().setCatalog(catalog);
  }, [catalog, store]);

  const spec = useStore(store, (s) => s.spec);
  const sql = useStore(store, (s) => s.sql);
  const diagnostics = useStore(store, (s) => s.diagnostics);
  const canUndo = useStore(store, (s) => s.undoStack.length > 0);
  const canRedo = useStore(store, (s) => s.redoStack.length > 0);
  const initialized = useStore(store, (s) => s.initialized);

  const targetSource = React.useMemo(
    () =>
      autoPopulateSourceId
        ? (catalog?.sources.find((s) => s.id === autoPopulateSourceId) ?? null)
        : null,
    [catalog, autoPopulateSourceId],
  );

  const placeTablesAndLayout = React.useCallback(
    async (tables: QueryCatalogTable[]) => {
      if (!catalog || tables.length === 0) return;
      const added = store.getState().addTables(tables);
      if (added.length === 0) return;
      const curr = store.getState();
      const links = findLinks(curr.spec.tables, curr.spec.joins, catalog);
      if (links.length > 0) {
        store.getState().addJoins(
          links.map((l) => ({
            left: l.left,
            right: l.right,
            options: {
              type: "INNER",
              cardinality: l.cardinality,
              origin: l.origin,
              constraintName: l.constraintName,
            },
          })),
        );
      }
      const afterJoins = store.getState();
      const positions = await layoutConnectedGroups(
        afterJoins.spec.tables,
        afterJoins.spec.joins,
        catalog,
      );
      if (Object.keys(positions).length > 0) {
        store.getState().applyLayout(positions);
      }
    },
    [catalog, store],
  );

  // Auto-generate when opening a single-source Visual Schema with <= 25 tables
  const autoRunRef = React.useRef(false);
  React.useEffect(() => {
    if (
      autoRunRef.current ||
      initialized ||
      !targetSource ||
      spec.tables.length > 0
    ) {
      return;
    }
    if (
      targetSource.tables.length > 0 &&
      targetSource.tables.length <= QUERY_SCHEMA_AUTO_PLACE_THRESHOLD
    ) {
      autoRunRef.current = true;
      store.getState().markInitialized();
      void placeTablesAndLayout(targetSource.tables);
    }
  }, [initialized, targetSource, spec.tables.length, store, placeTablesAndLayout]);

  const catalogByAsset = React.useMemo(() => {
    const map = new Map<
      string,
      { table: QueryCatalogTable; source: QueryCatalogSource }
    >();
    for (const src of catalog?.sources ?? []) {
      for (const tbl of src.tables) {
        map.set(tbl.assetId, { table: tbl, source: src });
      }
    }
    return map;
  }, [catalog]);

  const lockedTablesOnCanvas = React.useMemo(
    () =>
      spec.tables.filter((tbl) => {
        const entry = catalogByAsset.get(tbl.assetId);
        return entry ? !entry.table.canQuery : false;
      }),
    [spec.tables, catalogByAsset],
  );

  const hasErrors = diagnostics.some((d) => d.level === "error");

  const adapter: VisualSchemaAdapter = React.useMemo(
    () => ({
      mode: "query-builder",
      capabilities: {
        canEdit: true,
        showColumnSelection: true,
        showFilters: true,
        showComments: false,
        maxTables: QUERY_SCHEMA_MAX_TABLES,
        allowLockedTables: true,
      },
      spec,
      catalog,
      diagnostics,
      canUndo,
      canRedo,
      addTables: (tables, positions) =>
        store.getState().addTables(tables, positions),
      removeTables: (ids) => store.getState().removeTables(ids),
      moveTables: (updates) => store.getState().moveTables(updates),
      resizeTable: (id, h) => store.getState().resizeTable(id, h),
      setTableColor: (ids, color) => store.getState().setTableColor(ids, color),
      toggleTableCollapsed: (id) => store.getState().toggleTableCollapsed(id),
      setTablesHidden: (ids, hidden) =>
        store.getState().setTablesHidden(ids, hidden),
      renameAlias: (id, alias) => store.getState().renameAlias(id, alias),
      toggleColumn: (id, col) => store.getState().toggleColumn(id, col),
      setTableColumns: (id, cols) => store.getState().setTableColumns(id, cols),
      addFilter: (id, filter) => store.getState().addFilter(id, filter),
      removeFilter: (id, idx) => store.getState().removeFilter(id, idx),
      addJoin: (l, r, opts) => store.getState().addJoin(l, r, opts),
      addJoins: (batch) => store.getState().addJoins(batch),
      updateJoin: (id, patch) => store.getState().updateJoin(id, patch),
      removeJoin: (id) => store.getState().removeJoin(id),
      removeTableJoins: (ids) => store.getState().removeTableJoins(ids),
      applyLayout: (pos) => store.getState().applyLayout(pos),
      clearCanvas: () => store.getState().clearCanvas(),
      importSpec: (next) => store.getState().importSpec(next),
      undo: () => store.getState().undo(),
      redo: () => store.getState().redo(),
      onRefreshCatalog,
    }),
    [spec, catalog, diagnostics, canUndo, canRedo, store, onRefreshCatalog],
  );

  const handleCopySql = async () => {
    if (!sql) return;
    if (await copyText(sql)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleRequestAsDataset = () => {
    const token = saveDataRequestDraft(spec);
    if (!token) {
      toast.error(t("visualSchema.export.failed"));
      return;
    }
    router.push(nsPath(`/cases/new/data-request?draft=${encodeURIComponent(token)}`));
  };

  const showLargeSourcePrompt =
    Boolean(targetSource) &&
    spec.tables.length === 0 &&
    (targetSource?.tables.length ?? 0) > QUERY_SCHEMA_AUTO_PLACE_THRESHOLD;

  const sqlTabContent = (
    <div
      className="flex h-full flex-col gap-2.5 p-3"
      data-testid="vs-query-sql-panel"
    >
      {/* Locked tables governance warning */}
      {lockedTablesOnCanvas.length > 0 && (
        <div
          className="rounded-xs border border-[var(--cb-amber)]/50 bg-[var(--cb-amber-soft)]/40 p-2.5 text-xs"
          data-testid="vs-locked-tables-notice"
        >
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--cb-amber)]" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium text-foreground">
                {t("dataQuery.schema.lockedTablesWarning", {
                  count: lockedTablesOnCanvas.length,
                })}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={handleRequestAsDataset}
                data-testid="vs-request-dataset-locked-btn"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                {t("dataQuery.schema.requestDataset")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostics */}
      {diagnostics.length > 0 && (
        <ul className="space-y-1">
          {diagnostics.map((d, idx) => (
            <li
              key={`${d.code}-${idx}`}
              className="flex items-start gap-1.5 rounded-xs border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive"
              data-testid={`sql-diagnostic-${d.code}`}
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{d.message}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Live read-only SQL preview */}
      <div className="min-h-[200px] flex-1 overflow-hidden rounded-xs border border-border/60">
        <SqlEditor
          value={
            sql ||
            `-- ${t("dataQuery.schema.emptySqlHint")}`
          }
          onChange={() => undefined}
          onRun={() => {
            if (sql && onOpenInSql) onOpenInSql(sql);
          }}
          catalog={catalog}
          path={`query://visual-schema/${scopeKey}.sql`}
          height="100%"
          readOnly
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        {onOpenInSql && (
          <Button
            type="button"
            size="sm"
            className="h-8 flex-1 gap-1.5 text-xs"
            disabled={!sql || hasErrors}
            onClick={() => onOpenInSql(sql)}
            data-testid="vs-open-in-sql-btn"
          >
            <TerminalSquare className="h-3.5 w-3.5" />
            {t("dataQuery.schema.openInSql")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs"
          disabled={!sql}
          onClick={() => void handleCopySql()}
          data-testid="vs-copy-sql-btn"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-[var(--accent-ink)]" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {t("dataQuery.objectView.copySql")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 gap-1 text-xs"
          disabled={spec.tables.length === 0}
          onClick={handleRequestAsDataset}
          data-testid="vs-request-dataset-btn"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          {t("dataQuery.schema.requestDataset")}
        </Button>
      </div>
    </div>
  );

  const topLeftSlot = (
    <div className="flex items-center gap-1 rounded-[6px] border-2 border-border bg-card p-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        disabled={!canUndo}
        onClick={() => store.getState().undo()}
        title={t("dataRequest.canvas.undo")}
        data-testid="vs-undo"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        disabled={!canRedo}
        onClick={() => store.getState().redo()}
        title={t("dataRequest.canvas.redo")}
        data-testid="vs-redo"
      >
        <Redo2 className="h-3.5 w-3.5" />
      </Button>
      {showLargeSourcePrompt && targetSource && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => {
            store.getState().markInitialized();
            void placeTablesAndLayout(
              targetSource.tables.slice(0, QUERY_SCHEMA_AUTO_PLACE_THRESHOLD),
            );
          }}
          data-testid="vs-place-first-25"
        >
          <Wand2 className="h-3.5 w-3.5" />
          {t("dataQuery.schema.placeFirstN", {
            count: QUERY_SCHEMA_AUTO_PLACE_THRESHOLD,
            total: targetSource.tables.length,
          })}
        </Button>
      )}
    </div>
  );

  return (
    <div className="h-full w-full min-h-[540px]" data-testid="query-schema-tab">
      <VisualSchemaWorkspace
        adapter={adapter}
        extensions={{
          topLeftSlot,
          defaultRightTab: "sql",
          rightTabs: [
            {
              value: "sql",
              label: t("dataRequest.panel.tabSql"),
              icon: <Code2 className="h-3.5 w-3.5" />,
              testId: "vs-tab-sql",
              content: sqlTabContent,
            },
          ],
          onInspectTableData: onOpenTable
            ? (tbl) => {
                const entry = catalogByAsset.get(tbl.assetId);
                if (entry) onOpenTable(entry.table, entry.source);
              }
            : undefined,
        }}
      />
    </div>
  );
}
