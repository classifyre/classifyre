import type {
  DataRequestCardinality,
  DataRequestJoin,
  DataRequestJoinEndpoint,
  DataRequestJoinOrigin,
  DataRequestTable,
} from "@workspace/schemas/data-request";
import type {
  QueryCatalog,
  QueryCatalogTable,
} from "@/lib/data-query";
import { indexCatalogByAsset } from "./catalog-helpers";

export interface SuggestedLink {
  left: DataRequestJoinEndpoint;
  right: DataRequestJoinEndpoint;
  cardinality: DataRequestCardinality;
  origin: DataRequestJoinOrigin;
  constraintName?: string;
}

function singularize(word: string): string {
  const lower = word.toLowerCase();
  if (lower.endsWith("ies") && lower.length > 4) {
    return `${lower.slice(0, -3)}y`;
  }
  if (
    (lower.endsWith("ses") ||
      lower.endsWith("xes") ||
      lower.endsWith("ches") ||
      lower.endsWith("shes")) &&
    lower.length > 4
  ) {
    return lower.slice(0, -2);
  }
  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 2) {
    return lower.slice(0, -1);
  }
  return lower;
}

function tableLeafName(table: DataRequestTable, catalogTable?: QueryCatalogTable): string {
  const raw = catalogTable?.table || table.sqlName.split(".").pop() || table.sqlName;
  return raw.toLowerCase();
}

function typeFamily(rawType?: string | null): "int" | "uuid" | "string" | "other" {
  if (!rawType) return "other";
  const t = rawType.trim().toLowerCase().split("(")[0]?.trim() ?? "";
  if (
    t === "int" ||
    t === "int2" ||
    t === "int4" ||
    t === "int8" ||
    t === "integer" ||
    t === "bigint" ||
    t === "smallint" ||
    t === "tinyint" ||
    t === "hugeint" ||
    t === "uinteger" ||
    t === "ubigint" ||
    t === "serial" ||
    t === "bigserial" ||
    t === "number" ||
    t === "numeric" ||
    t === "decimal"
  ) {
    return "int";
  }
  if (t === "uuid" || t === "guid" || t === "uniqueidentifier") return "uuid";
  if (
    t === "varchar" ||
    t === "text" ||
    t === "string" ||
    t === "char" ||
    t === "character varying" ||
    t === "nvarchar"
  ) {
    return "string";
  }
  return "other";
}

function typesCompatible(a?: string | null, b?: string | null): boolean {
  const fa = typeFamily(a);
  const fb = typeFamily(b);
  if (fa === "other" || fb === "other") return true;
  if (fa === fb) return true;
  // UUIDs are often stored as VARCHAR in lakehouse / CSV exports
  if ((fa === "uuid" && fb === "string") || (fa === "string" && fb === "uuid")) {
    return true;
  }
  return false;
}

function pairKey(
  aTableId: string,
  aCol: string,
  bTableId: string,
  bCol: string,
): string {
  const left = `${aTableId}:${aCol.toLowerCase()}`;
  const right = `${bTableId}:${bCol.toLowerCase()}`;
  return left < right ? `${left}<->${right}` : `${right}<->${left}`;
}

function resolvePrimaryKeyColumn(
  targetCatalog: QueryCatalogTable,
): { name: string; type: string } | null {
  const pks = targetCatalog.columns.filter((c) => c.isPrimaryKey);
  if (pks.length === 1) return pks[0]!;
  const idCol = targetCatalog.columns.find((c) => c.name.toLowerCase() === "id");
  if (idCol) return idCol;
  const leaf = singularize(targetCatalog.table || targetCatalog.name);
  const namedId = targetCatalog.columns.find(
    (c) => c.name.toLowerCase() === `${leaf}_id`,
  );
  return namedId ?? null;
}

/**
 * Discover candidate join links across placed tables (3-tier priority):
 * 1. Exact column-level catalog FOREIGN_KEY relations (origin: "fk")
 * 2. Table-level catalog FOREIGN_KEY hints resolved against visible columns (origin: "fk")
 * 3. High-confidence `<target_singular>_id` -> `target.<pk|id>` naming/type heuristics (origin: "inferred")
 *
 * Security invariant: ONLY ever inspects columns present in the caller's post-mask
 * `catalog.sources[].tables[].columns`. Never references hidden/restricted columns.
 */
export function findLinks(
  tables: readonly DataRequestTable[],
  existingJoins: readonly DataRequestJoin[],
  catalog: QueryCatalog | null,
  scopeTableIds?: ReadonlySet<string>,
): SuggestedLink[] {
  if (!catalog || tables.length < 2) return [];

  const catalogByAsset = indexCatalogByAsset(catalog);

  const tablesByAsset = new Map<string, DataRequestTable[]>();
  for (const tbl of tables) {
    const list = tablesByAsset.get(tbl.assetId) ?? [];
    list.push(tbl);
    tablesByAsset.set(tbl.assetId, list);
  }

  const seenPairs = new Set<string>();
  for (const j of existingJoins) {
    seenPairs.add(
      pairKey(j.left.tableId, j.left.column, j.right.tableId, j.right.column),
    );
  }

  const suggestions: SuggestedLink[] = [];
  const inScope = (aId: string, bId: string) =>
    !scopeTableIds || scopeTableIds.has(aId) || scopeTableIds.has(bId);

  const pushUnique = (candidate: SuggestedLink) => {
    if (candidate.left.tableId === candidate.right.tableId) return;
    if (!inScope(candidate.left.tableId, candidate.right.tableId)) return;
    const key = pairKey(
      candidate.left.tableId,
      candidate.left.column,
      candidate.right.tableId,
      candidate.right.column,
    );
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    suggestions.push(candidate);
  };

  // Tier 1 & Tier 2: Catalog FOREIGN_KEY relations (already governance-filtered by API)
  const relations = catalog.relations ?? [];
  for (const rel of relations) {
    const fromTables = tablesByAsset.get(rel.fromAssetId) ?? [];
    const toTables = tablesByAsset.get(rel.toAssetId) ?? [];
    const fromCat = catalogByAsset.get(rel.fromAssetId);
    const toCat = catalogByAsset.get(rel.toAssetId);
    if (!fromTables.length || !toTables.length || !fromCat || !toCat) continue;

    // Tier 1: Exact column-level catalog FK
    if (rel.fromColumn && rel.toColumn) {
      const matchedFrom = fromCat.columns.find(
        (c) => c.name.toLowerCase() === rel.fromColumn!.toLowerCase(),
      );
      const matchedTo = toCat.columns.find(
        (c) => c.name.toLowerCase() === rel.toColumn!.toLowerCase(),
      );
      if (!matchedFrom || !matchedTo) continue;

      for (const ft of fromTables) {
        for (const tt of toTables) {
          pushUnique({
            left: { tableId: ft.id, column: matchedFrom.name },
            right: { tableId: tt.id, column: matchedTo.name },
            cardinality: rel.cardinality ?? "N-1",
            origin: "fk",
            ...(rel.constraintName ? { constraintName: rel.constraintName } : {}),
          });
        }
      }
      continue;
    }

    // Tier 2: Table-level catalog FK hint -> match columns between these two tables
    const targetPk = resolvePrimaryKeyColumn(toCat);
    if (!targetPk) continue;
    const targetLeaf = tableLeafName(toTables[0]!, toCat);
    const targetSingular = singularize(targetLeaf);
    const candidateNames = new Set([
      `${targetSingular}_id`,
      `${targetLeaf}_id`,
      `${targetSingular}id`,
      targetPk.name.toLowerCase(),
    ]);

    const matchedFrom = fromCat.columns.find((c) => {
      const lower = c.name.toLowerCase();
      if (lower === "id" && targetPk.name.toLowerCase() === "id") return false;
      return (
        candidateNames.has(lower) && typesCompatible(c.type, targetPk.type)
      );
    });
    if (!matchedFrom) continue;

    for (const ft of fromTables) {
      for (const tt of toTables) {
        pushUnique({
          left: { tableId: ft.id, column: matchedFrom.name },
          right: { tableId: tt.id, column: targetPk.name },
          cardinality: rel.cardinality ?? "N-1",
          origin: "fk",
        });
      }
    }
  }

  // Tier 3: Heuristic `<target_singular>_id` -> `target.<pk|id>` across placed tables
  for (const sourceTable of tables) {
    const sourceCat = catalogByAsset.get(sourceTable.assetId);
    if (!sourceCat) continue;
    for (const targetTable of tables) {
      if (sourceTable.id === targetTable.id) continue;
      if (!inScope(sourceTable.id, targetTable.id)) continue;
      const targetCat = catalogByAsset.get(targetTable.assetId);
      if (!targetCat) continue;

      const targetPk = resolvePrimaryKeyColumn(targetCat);
      if (!targetPk) continue;

      const targetLeaf = tableLeafName(targetTable, targetCat);
      const targetSingular = singularize(targetLeaf);
      if (targetSingular.length < 2) continue;

      const wantedNames = new Set([
        `${targetSingular}_id`,
        `${targetLeaf}_id`,
        `${targetSingular}id`,
      ]);

      for (const col of sourceCat.columns) {
        const lower = col.name.toLowerCase();
        if (!wantedNames.has(lower)) continue;
        if (!typesCompatible(col.type, targetPk.type)) continue;

        pushUnique({
          left: { tableId: sourceTable.id, column: col.name },
          right: { tableId: targetTable.id, column: targetPk.name },
          cardinality: "N-1",
          origin: "inferred",
        });
      }
    }
  }

  return suggestions;
}
