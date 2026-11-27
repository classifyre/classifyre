"use client";

import * as React from "react";
import {
  EMPTY_DATA_REQUEST_SPEC,
  generateRequestSql,
  suggestTableAlias,
  type DataRequestJoin,
  type DataRequestSpec,
  type DataRequestTable,
} from "@workspace/schemas/data-request";
import type { QueryCatalog, QueryCatalogTable } from "@/lib/data-query";
import { VisualSchemaWorkspace } from "@/components/visual-schema/visual-schema-workspace";
import {
  snapSchemaCoord,
  type VisualSchemaAdapter,
} from "@/components/visual-schema/types";

const SAMPLE_CATALOG: QueryCatalog = {
  canQueryAll: true,
  limits: { maxRows: 1000, timeoutSeconds: 60, exportMaxRows: 10000 },
  sources: [
    {
      id: "s-shop",
      name: "Shop Postgres",
      type: "POSTGRESQL",
      sqlName: "shop",
      queryable: true,
      tables: [
        {
          assetId: "a-orders",
          sourceId: "s-shop",
          name: "orders",
          schema: "public",
          table: "orders",
          sqlName: "shop.public.orders",
          queryable: true,
          canQuery: true,
          rowCount: 14200,
          hiddenColumns: 1,
          columns: [
            { name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false },
            { name: "customer_id", type: "BIGINT", nullable: false },
            { name: "amount", type: "NUMERIC", nullable: true },
          ],
        },
        {
          assetId: "a-customers",
          sourceId: "s-shop",
          name: "customers",
          schema: "public",
          table: "customers",
          sqlName: "shop.public.customers",
          queryable: true,
          canQuery: false,
          rowCount: 4100,
          columns: [
            { name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false },
            {
              name: "email",
              type: "VARCHAR",
              nullable: false,
              access: "mask",
              mask: "redact",
            },
            { name: "country", type: "VARCHAR", nullable: true },
          ],
        },
      ],
    },
  ],
  relations: [
    {
      fromAssetId: "a-orders",
      fromColumn: "customer_id",
      toAssetId: "a-customers",
      toColumn: "id",
      constraintName: "fk_orders_customer",
      cardinality: "N-1",
    },
  ],
};

export function VisualSchemaHarness({ dark = false }: { dark?: boolean }) {
  const [spec, setSpec] = React.useState<DataRequestSpec>(EMPTY_DATA_REQUEST_SPEC);
  const [undoStack, setUndoStack] = React.useState<DataRequestSpec[]>([]);
  const [redoStack, setRedoStack] = React.useState<DataRequestSpec[]>([]);

  const commit = React.useCallback((updater: (prev: DataRequestSpec) => DataRequestSpec) => {
    setSpec((prev) => {
      const next = updater(prev);
      setUndoStack((u) => [...u.slice(-49), prev]);
      setRedoStack([]);
      return next;
    });
  }, []);

  const diagnostics = React.useMemo(() => generateRequestSql(spec).diagnostics, [spec]);

  const adapter: VisualSchemaAdapter = React.useMemo(
    () => ({
      mode: "query-builder",
      capabilities: {
        canEdit: true,
        showColumnSelection: true,
        showFilters: true,
        showComments: false,
        maxTables: 20,
        allowLockedTables: true,
      },
      spec,
      catalog: SAMPLE_CATALOG,
      diagnostics,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      addTables: (tables: QueryCatalogTable[], positions?: Array<{ x: number; y: number }>) => {
        const added: DataRequestTable[] = [];
        commit((prev) => {
          const taken = new Set(prev.tables.map((t) => t.alias.toLowerCase()));
          const nextTables = [...prev.tables];
          tables.forEach((tbl, i) => {
            const alias = suggestTableAlias(tbl.sqlName, taken);
            taken.add(alias);
            const entry: DataRequestTable = {
              id: `t_${nextTables.length + 1}`,
              assetId: tbl.assetId,
              sqlName: tbl.sqlName,
              alias,
              x: snapSchemaCoord(positions?.[i]?.x ?? 40 + nextTables.length * 320),
              y: snapSchemaCoord(positions?.[i]?.y ?? 60),
              keep: tbl.columns.map((c) => c.name),
              filters: [],
            };
            nextTables.push(entry);
            added.push(entry);
          });
          return { ...prev, tables: nextTables };
        });
        return added;
      },
      removeTables: (ids) => {
        const set = new Set(ids);
        commit((prev) => ({
          ...prev,
          tables: prev.tables.filter((t) => !set.has(t.id)),
          joins: prev.joins.filter(
            (j) => !set.has(j.left.tableId) && !set.has(j.right.tableId),
          ),
        }));
      },
      moveTables: (updates) => {
        commit((prev) => ({
          ...prev,
          tables: prev.tables.map((t) =>
            updates[t.id] ? { ...t, x: updates[t.id]!.x, y: updates[t.id]!.y } : t,
          ),
        }));
      },
      resizeTable: (tableId, height) => {
        commit((prev) => ({
          ...prev,
          tables: prev.tables.map((t) => (t.id === tableId ? { ...t, height } : t)),
        }));
      },
      setTableColor: (ids, color) => {
        const set = new Set(ids);
        commit((prev) => ({
          ...prev,
          tables: prev.tables.map((t) => (set.has(t.id) ? { ...t, color } : t)),
        }));
      },
      toggleTableCollapsed: (tableId) => {
        commit((prev) => ({
          ...prev,
          tables: prev.tables.map((t) =>
            t.id === tableId ? { ...t, collapsed: !t.collapsed } : t,
          ),
        }));
      },
      setTablesHidden: (ids, hidden) => {
        const set = new Set(ids);
        commit((prev) => ({
          ...prev,
          tables: prev.tables.map((t) => (set.has(t.id) ? { ...t, hidden } : t)),
        }));
      },
      renameAlias: (tableId, alias) => {
        if (!/^[a-z_][a-z0-9_]*$/.test(alias)) return false;
        commit((prev) => ({
          ...prev,
          tables: prev.tables.map((t) => (t.id === tableId ? { ...t, alias } : t)),
        }));
        return true;
      },
      toggleColumn: (tableId, col) => {
        commit((prev) => ({
          ...prev,
          tables: prev.tables.map((t) => {
            if (t.id !== tableId) return t;
            const has = t.keep.includes(col);
            return {
              ...t,
              keep: has ? t.keep.filter((c) => c !== col) : [...t.keep, col],
            };
          }),
        }));
      },
      setTableColumns: (tableId, columns) => {
        commit((prev) => ({
          ...prev,
          tables: prev.tables.map((t) =>
            t.id === tableId ? { ...t, keep: [...columns] } : t,
          ),
        }));
      },
      addFilter: (tableId, filter) => {
        commit((prev) => ({
          ...prev,
          tables: prev.tables.map((t) =>
            t.id === tableId ? { ...t, filters: [...t.filters, filter] } : t,
          ),
        }));
      },
      removeFilter: (tableId, idx) => {
        commit((prev) => ({
          ...prev,
          tables: prev.tables.map((t) =>
            t.id === tableId
              ? {
                  ...t,
                  filters:
                    typeof idx === "number"
                      ? t.filters.filter((_, i) => i !== idx)
                      : t.filters.filter((f) => f.id !== idx),
                }
              : t,
          ),
        }));
      },
      addJoin: (left, right, options) => {
        const join: DataRequestJoin = {
          id: `j_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          left,
          right,
          type: options?.type ?? "INNER",
          ...(options?.cardinality ? { cardinality: options.cardinality } : {}),
          ...(options?.origin ? { origin: options.origin } : {}),
          ...(options?.constraintName
            ? { constraintName: options.constraintName }
            : {}),
        };
        commit((prev) => ({ ...prev, joins: [...prev.joins, join] }));
        return join;
      },
      addJoins: (batch) => {
        const created: DataRequestJoin[] = batch.map((b, idx) => ({
          id: `j_${Date.now()}_${idx}`,
          left: b.left,
          right: b.right,
          type: b.options?.type ?? "INNER",
          ...(b.options?.cardinality ? { cardinality: b.options.cardinality } : {}),
          ...(b.options?.origin ? { origin: b.options.origin } : {}),
          ...(b.options?.constraintName
            ? { constraintName: b.options.constraintName }
            : {}),
        }));
        commit((prev) => ({ ...prev, joins: [...prev.joins, ...created] }));
        return created;
      },
      updateJoin: (joinId, patch) => {
        commit((prev) => ({
          ...prev,
          joins: prev.joins.map((j) => (j.id === joinId ? { ...j, ...patch } : j)),
        }));
      },
      removeJoin: (joinId) => {
        commit((prev) => ({
          ...prev,
          joins: prev.joins.filter((j) => j.id !== joinId),
        }));
      },
      removeTableJoins: (ids) => {
        const set = new Set(ids);
        commit((prev) => ({
          ...prev,
          joins: prev.joins.filter(
            (j) => !set.has(j.left.tableId) && !set.has(j.right.tableId),
          ),
        }));
      },
      applyLayout: (positions) => {
        commit((prev) => ({
          ...prev,
          tables: prev.tables.map((t) =>
            positions[t.id]
              ? { ...t, x: positions[t.id]!.x, y: positions[t.id]!.y }
              : t,
          ),
        }));
      },
      clearCanvas: () => {
        commit((prev) => ({ ...prev, tables: [], joins: [] }));
      },
      importSpec: (next) => {
        commit(() => next);
      },
      undo: () => {
        setUndoStack((u) => {
          if (u.length === 0) return u;
          const prev = u[u.length - 1]!;
          setRedoStack((r) => [...r, spec]);
          setSpec(prev);
          return u.slice(0, -1);
        });
      },
      redo: () => {
        setRedoStack((r) => {
          if (r.length === 0) return r;
          const next = r[r.length - 1]!;
          setUndoStack((u) => [...u, spec]);
          setSpec(next);
          return r.slice(0, -1);
        });
      },
    }),
    [spec, diagnostics, undoStack.length, redoStack.length, commit],
  );

  return (
    <div
      className={dark ? "dark h-[720px] w-[1280px]" : "h-[720px] w-[1280px]"}
      style={{ width: 1280, height: 720, position: "relative" }}
    >
      <VisualSchemaWorkspace adapter={adapter} />
    </div>
  );
}
