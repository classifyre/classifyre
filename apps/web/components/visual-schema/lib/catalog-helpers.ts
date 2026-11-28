import { toast } from "sonner";
import type { DataRequestTable } from "@workspace/schemas/data-request";
import type {
  QueryCatalog,
  QueryCatalogSource,
  QueryCatalogTable,
} from "@/lib/data-query";
import type { SuggestedLink } from "./find-links";
import type { VisualSchemaAdapter } from "../types";

export function indexCatalogByAsset(
  catalog: QueryCatalog | null,
): Map<string, QueryCatalogTable> {
  const map = new Map<string, QueryCatalogTable>();
  for (const src of catalog?.sources ?? []) {
    for (const tbl of src.tables) {
      map.set(tbl.assetId, tbl);
    }
  }
  return map;
}

export function indexCatalogWithSource(
  catalog: QueryCatalog | null,
): Map<string, { table: QueryCatalogTable; source: QueryCatalogSource }> {
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
}

export function indexFkColumnsByAsset(
  catalog: QueryCatalog | null,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const rel of catalog?.relations ?? []) {
    if (rel.fromColumn) {
      const set = map.get(rel.fromAssetId) ?? new Set<string>();
      set.add(rel.fromColumn.toLowerCase());
      map.set(rel.fromAssetId, set);
    }
  }
  return map;
}

export function addSuggestedJoins(
  adapter: Pick<VisualSchemaAdapter, "addJoin" | "addJoins">,
  links: readonly SuggestedLink[],
): void {
  if (links.length === 0) return;
  if (adapter.addJoins) {
    adapter.addJoins(
      links.map((link) => ({
        left: link.left,
        right: link.right,
        options: {
          type: "INNER",
          cardinality: link.cardinality,
          origin: link.origin,
          constraintName: link.constraintName,
        },
      })),
    );
    return;
  }
  for (const link of links) {
    adapter.addJoin(link.left, link.right, {
      type: "INNER",
      cardinality: link.cardinality,
      origin: link.origin,
      constraintName: link.constraintName,
    });
  }
}

export function addTablesWithCapToast(
  adapter: Pick<VisualSchemaAdapter, "spec" | "capabilities" | "addTables">,
  tables: QueryCatalogTable[],
  positions: Array<{ x: number; y: number }> | undefined,
  t: (
    key:
      | "visualSchema.toast.maxTablesReached"
      | "visualSchema.toast.truncatedTables",
    params?: Record<string, string | number>,
  ) => string,
): DataRequestTable[] {
  if (tables.length === 0) return [];
  const cap = adapter.capabilities.maxTables;
  if (cap !== null) {
    const room = Math.max(0, cap - adapter.spec.tables.length);
    if (room === 0) {
      toast.warning(t("visualSchema.toast.maxTablesReached", { max: cap }));
      return [];
    }
    const batch = tables.slice(0, room);
    const batchPositions = positions?.slice(0, room);
    const added = adapter.addTables(batch, batchPositions);
    if (batch.length < tables.length) {
      toast.warning(
        t("visualSchema.toast.truncatedTables", {
          added: added.length,
          total: tables.length,
        }),
      );
    }
    return added;
  }
  return adapter.addTables(tables, positions);
}
