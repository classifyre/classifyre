import { z } from "zod";
import {
  DATA_REQUEST_MAX_GROUPS,
  DATA_REQUEST_MAX_JOINS,
  DATA_REQUEST_MAX_PINS,
  DATA_REQUEST_MAX_TABLES,
  DataRequestGroupSchema,
  DataRequestJoinSchema,
  DataRequestPinSchema,
  DataRequestTableSchema,
  suggestTableAlias,
  type DataRequestFilter,
  type DataRequestJoin,
  type DataRequestJoinEndpoint,
  type DataRequestPin,
  type DataRequestSpec,
  type DataRequestTable,
  type RequestTableMeta,
  type SchemaTableColor,
} from "@workspace/schemas/data-request";
import { snapSchemaCoord, type JoinPatch } from "../types";

export const VISUAL_SCHEMA_MAX_TABLES = 40;
export const VISUAL_SCHEMA_MAX_JOINS = 160;

const PLAIN_IDENT = /^[a-z_][a-z0-9_]*$/;

export interface CatalogTableLike {
  assetId: string;
  sqlName: string;
  columns: ReadonlyArray<{ name: string; type?: string | null }>;
}

export interface CatalogLike {
  sources?: ReadonlyArray<{ tables: ReadonlyArray<CatalogTableLike> }>;
}

export function createVisualSchemaSpecSchema(
  maxTables = VISUAL_SCHEMA_MAX_TABLES,
  maxJoins = VISUAL_SCHEMA_MAX_JOINS,
) {
  return z.strictObject({
    tables: z
      .array(DataRequestTableSchema)
      .max(Math.max(DATA_REQUEST_MAX_TABLES + 4, maxTables))
      .default([]),
    joins: z
      .array(DataRequestJoinSchema)
      .max(Math.max(DATA_REQUEST_MAX_JOINS, maxJoins))
      .default([]),
    pins: z.array(DataRequestPinSchema).max(DATA_REQUEST_MAX_PINS).default([]),
    groups: z
      .array(DataRequestGroupSchema)
      .max(DATA_REQUEST_MAX_GROUPS)
      .default([]),
  });
}

export const VisualSchemaSpecSchema = createVisualSchemaSpecSchema();

export function makeSpecId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildCatalogLookup(
  catalog: CatalogLike | null,
): Map<string, RequestTableMeta> | undefined {
  if (!catalog) return undefined;
  const map = new Map<string, RequestTableMeta>();
  for (const src of catalog.sources ?? []) {
    for (const tbl of src.tables) {
      map.set(tbl.assetId, {
        sqlName: tbl.sqlName,
        exists: true,
        columns: tbl.columns.map((c) => ({ name: c.name, type: c.type ?? "" })),
      });
    }
  }
  return map;
}

export function addTablesToSpec(
  spec: DataRequestSpec,
  tables: ReadonlyArray<CatalogTableLike>,
  options: {
    maxTables: number;
    positions?: ReadonlyArray<{ x: number; y: number }>;
    colStepX?: number;
    colStepY?: number;
  },
): { spec: DataRequestSpec; created: DataRequestTable[] } | null {
  const remaining = Math.max(0, options.maxTables - spec.tables.length);
  if (remaining === 0 || tables.length === 0) return null;

  const stepX = options.colStepX ?? 300;
  const stepY = options.colStepY ?? 260;
  const batch = tables.slice(0, remaining);
  const taken = new Set(spec.tables.map((t) => t.alias.toLowerCase()));
  const nextTables = [...spec.tables];
  const created: DataRequestTable[] = [];

  batch.forEach((tbl, idx) => {
    const alias = suggestTableAlias(tbl.sqlName, taken);
    taken.add(alias.toLowerCase());
    const pos = options.positions?.[idx];
    const count = nextTables.length;
    const entry: DataRequestTable = {
      id: makeSpecId("tbl"),
      assetId: tbl.assetId,
      sqlName: tbl.sqlName,
      alias,
      x: snapSchemaCoord(pos?.x ?? 60 + (count % 3) * stepX),
      y: snapSchemaCoord(pos?.y ?? 60 + Math.floor(count / 3) * stepY),
      keep: tbl.columns.slice(0, 8).map((c) => c.name),
      filters: [],
    };
    nextTables.push(entry);
    created.push(entry);
  });

  return {
    spec: { ...spec, tables: nextTables },
    created,
  };
}

export function removeTablesFromSpec(
  spec: DataRequestSpec,
  tableIds: readonly string[],
  options?: { unanchorPins?: boolean },
): DataRequestSpec | null {
  const ids = new Set(tableIds);
  if (ids.size === 0) return null;
  return {
    ...spec,
    tables: spec.tables.filter((t) => !ids.has(t.id)),
    joins: spec.joins.filter(
      (j) => !ids.has(j.left.tableId) && !ids.has(j.right.tableId),
    ),
    ...(options?.unanchorPins
      ? {
          pins: spec.pins.map((p) =>
            p.anchor?.tableId && ids.has(p.anchor.tableId)
              ? { ...p, anchor: null }
              : p,
          ),
        }
      : {}),
  };
}

export function moveTablesInSpec(
  spec: DataRequestSpec,
  updates: Record<string, { x: number; y: number }>,
): DataRequestSpec | null {
  let changed = false;
  const nextTables = spec.tables.map((t) => {
    const u = updates[t.id];
    if (!u) return t;
    const sx = snapSchemaCoord(u.x);
    const sy = snapSchemaCoord(u.y);
    if (t.x === sx && t.y === sy) return t;
    changed = true;
    return { ...t, x: sx, y: sy };
  });
  if (!changed) return null;
  return { ...spec, tables: nextTables };
}

export function resizeTableInSpec(
  spec: DataRequestSpec,
  tableId: string,
  height: number,
): DataRequestSpec {
  const clamped = Math.max(120, Math.min(960, Math.round(height)));
  return {
    ...spec,
    tables: spec.tables.map((t) =>
      t.id === tableId ? { ...t, height: clamped } : t,
    ),
  };
}

export function setTableColorInSpec(
  spec: DataRequestSpec,
  tableIds: readonly string[],
  color: SchemaTableColor | undefined,
): DataRequestSpec | null {
  const ids = new Set(tableIds);
  if (ids.size === 0) return null;
  return {
    ...spec,
    tables: spec.tables.map((t) => {
      if (!ids.has(t.id)) return t;
      const next = { ...t };
      if (color) next.color = color;
      else delete next.color;
      return next;
    }),
  };
}

export function toggleTableCollapsedInSpec(
  spec: DataRequestSpec,
  tableId: string,
): DataRequestSpec {
  return {
    ...spec,
    tables: spec.tables.map((t) =>
      t.id === tableId ? { ...t, collapsed: !t.collapsed } : t,
    ),
  };
}

export function setTablesCollapsedInSpec(
  spec: DataRequestSpec,
  tableIds: readonly string[],
  collapsed: boolean,
): DataRequestSpec | null {
  const ids = new Set(tableIds);
  if (ids.size === 0) return null;
  return {
    ...spec,
    tables: spec.tables.map((t) =>
      ids.has(t.id) ? { ...t, collapsed } : t,
    ),
  };
}

export function setTablesHiddenInSpec(
  spec: DataRequestSpec,
  tableIds: readonly string[],
  hidden: boolean,
): DataRequestSpec | null {
  const ids = new Set(tableIds);
  if (ids.size === 0) return null;
  return {
    ...spec,
    tables: spec.tables.map((t) => (ids.has(t.id) ? { ...t, hidden } : t)),
  };
}

export function renameTableAliasInSpec(
  spec: DataRequestSpec,
  tableId: string,
  alias: string,
): DataRequestSpec | null {
  const clean = alias.trim().toLowerCase();
  if (!PLAIN_IDENT.test(clean)) return null;
  const clash = spec.tables.some(
    (t) => t.id !== tableId && t.alias.toLowerCase() === clean,
  );
  if (clash) return null;
  return {
    ...spec,
    tables: spec.tables.map((t) =>
      t.id === tableId ? { ...t, alias: clean } : t,
    ),
  };
}

export function toggleColumnInSpec(
  spec: DataRequestSpec,
  tableId: string,
  column: string,
): DataRequestSpec {
  return {
    ...spec,
    tables: spec.tables.map((t) => {
      if (t.id !== tableId) return t;
      const has = t.keep.includes(column);
      return {
        ...t,
        keep: has ? t.keep.filter((c) => c !== column) : [...t.keep, column],
      };
    }),
  };
}

export function setTableColumnsInSpec(
  spec: DataRequestSpec,
  tableId: string,
  columns: readonly string[],
): DataRequestSpec {
  return {
    ...spec,
    tables: spec.tables.map((t) =>
      t.id === tableId ? { ...t, keep: [...columns] } : t,
    ),
  };
}

export function setTablesColumnsInSpec(
  spec: DataRequestSpec,
  updates: Record<string, readonly string[]>,
): DataRequestSpec | null {
  const keys = Object.keys(updates);
  if (keys.length === 0) return null;
  return {
    ...spec,
    tables: spec.tables.map((t) => {
      const next = updates[t.id];
      return next ? { ...t, keep: [...next] } : t;
    }),
  };
}

export function addFilterInSpec(
  spec: DataRequestSpec,
  tableId: string,
  filter: DataRequestFilter,
): DataRequestSpec {
  const withId: DataRequestFilter = {
    ...filter,
    id: filter.id ?? makeSpecId("flt"),
  };
  return {
    ...spec,
    tables: spec.tables.map((t) =>
      t.id === tableId ? { ...t, filters: [...t.filters, withId] } : t,
    ),
  };
}

export function removeFilterInSpec(
  spec: DataRequestSpec,
  tableId: string,
  indexOrId: number | string,
): DataRequestSpec {
  return {
    ...spec,
    tables: spec.tables.map((t) => {
      if (t.id !== tableId) return t;
      const filters =
        typeof indexOrId === "number"
          ? t.filters.filter((_, i) => i !== indexOrId)
          : t.filters.filter((f) => f.id !== indexOrId);
      return { ...t, filters };
    }),
  };
}

export function addJoinsToSpec(
  spec: DataRequestSpec,
  batch: ReadonlyArray<{
    left: DataRequestJoinEndpoint;
    right: DataRequestJoinEndpoint;
    options?: JoinPatch;
  }>,
): { spec: DataRequestSpec; created: DataRequestJoin[] } | null {
  const nextJoins = [...spec.joins];
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
      id: makeSpecId("jn"),
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

  if (created.length === 0) return null;
  return {
    spec: { ...spec, joins: nextJoins },
    created,
  };
}

export function updateJoinInSpec(
  spec: DataRequestSpec,
  joinId: string,
  patch: JoinPatch,
): DataRequestSpec {
  return {
    ...spec,
    joins: spec.joins.map((j) => {
      if (j.id !== joinId) return j;
      const next: DataRequestJoin = { ...j, ...patch };
      if ("cardinality" in patch && patch.cardinality === undefined) {
        delete next.cardinality;
      }
      return next;
    }),
  };
}

export function removeJoinFromSpec(
  spec: DataRequestSpec,
  joinId: string,
): DataRequestSpec {
  return {
    ...spec,
    joins: spec.joins.filter((j) => j.id !== joinId),
  };
}

export function removeTableJoinsFromSpec(
  spec: DataRequestSpec,
  tableIds: readonly string[],
): DataRequestSpec | null {
  const ids = new Set(tableIds);
  const nextJoins = spec.joins.filter(
    (j) => !ids.has(j.left.tableId) && !ids.has(j.right.tableId),
  );
  if (nextJoins.length === spec.joins.length) return null;
  return { ...spec, joins: nextJoins };
}

/**
 * Security sanitization: strip columns, filters, and joins referencing columns
 * not visible in the caller's governance-filtered catalog, and optionally prune
 * missing tables, cap counts, or preserve server-managed comment pins.
 */
export function sanitizeSpecAgainstCatalog(
  spec: DataRequestSpec,
  catalog: CatalogLike | null,
  options?: {
    dropMissingTables?: boolean;
    maxTables?: number;
    maxJoins?: number;
    preservePins?: DataRequestPin[];
  },
): DataRequestSpec {
  const dropMissing = options?.dropMissingTables ?? true;
  const cappedTables =
    options?.maxTables !== undefined
      ? spec.tables.slice(0, options.maxTables)
      : spec.tables;

  const tablesByAsset = new Map<string, CatalogTableLike>();
  if (catalog) {
    for (const src of catalog.sources ?? []) {
      for (const tbl of src.tables) tablesByAsset.set(tbl.assetId, tbl);
    }
  }

  const keptTables: DataRequestTable[] = [];
  const validColsByTableId = new Map<string, Set<string>>();
  const keptTableIds = new Set<string>();

  for (const tbl of cappedTables) {
    const cat = catalog ? tablesByAsset.get(tbl.assetId) : undefined;
    if (catalog && !cat && dropMissing) continue;

    keptTableIds.add(tbl.id);
    if (!cat) {
      keptTables.push(tbl);
      continue;
    }

    const validCols = new Set(cat.columns.map((c) => c.name.toLowerCase()));
    validColsByTableId.set(tbl.id, validCols);
    keptTables.push({
      ...tbl,
      sqlName: cat.sqlName,
      keep: tbl.keep.filter((c) => validCols.has(c.toLowerCase())),
      filters: tbl.filters.filter((f) => validCols.has(f.column.toLowerCase())),
    });
  }

  let keptJoins = spec.joins.filter((j) => {
    if (!keptTableIds.has(j.left.tableId) || !keptTableIds.has(j.right.tableId)) {
      return false;
    }
    const leftCols = validColsByTableId.get(j.left.tableId);
    const rightCols = validColsByTableId.get(j.right.tableId);
    if (leftCols && !leftCols.has(j.left.column.toLowerCase())) return false;
    if (rightCols && !rightCols.has(j.right.column.toLowerCase())) return false;
    return true;
  });

  if (options?.maxJoins !== undefined) {
    keptJoins = keptJoins.slice(0, options.maxJoins);
  }

  const pins = options?.preservePins
    ? options.preservePins.map((p) =>
        p.anchor?.tableId && !keptTableIds.has(p.anchor.tableId)
          ? { ...p, anchor: null }
          : p,
      )
    : spec.pins;

  return {
    tables: keptTables,
    joins: keptJoins,
    pins,
    groups: spec.groups ?? [],
  };
}
