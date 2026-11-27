import type {
  DataRequestCardinality,
  DataRequestSpec,
} from "@workspace/schemas/data-request";
import type {
  QueryCatalog,
  QueryCatalogTable,
} from "@/lib/data-query";

type QueryCatalogColumn = QueryCatalogTable["columns"][number];

function findCatalogTable(
  catalog: QueryCatalog | null,
  assetId: string,
): QueryCatalogTable | undefined {
  if (!catalog) return undefined;
  for (const src of catalog.sources) {
    const found = src.tables.find((t) => t.assetId === assetId);
    if (found) return found;
  }
  return undefined;
}

function quoteDbmlIdent(ident: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) return ident;
  return `"${ident.replace(/"/g, '\\"')}"`;
}

function dbmlTableRef(table: { schema?: string; table: string }): string {
  const parts: string[] = [];
  if (table.schema) parts.push(quoteDbmlIdent(table.schema));
  parts.push(quoteDbmlIdent(table.table));
  return parts.join(".");
}

function dbmlColumnType(rawType?: string): string {
  const cleaned = (rawType ?? "unknown").trim();
  if (!cleaned) return "unknown";
  return /\s/.test(cleaned) ? `"${cleaned.replace(/"/g, '\\"')}"` : cleaned;
}

function dbmlColumnAttrs(col: QueryCatalogColumn): string {
  const attrs: string[] = [];
  if (col.isPrimaryKey) attrs.push("pk");
  if (col.nullable === false) attrs.push("not null");
  return attrs.length > 0 ? ` [${attrs.join(", ")}]` : "";
}

function dbmlCardinalityOp(cardinality?: DataRequestCardinality): string {
  switch (cardinality) {
    case "1-1":
      return "-";
    case "1-N":
      return "<";
    case "N-N":
      return "<>";
    case "N-1":
    default:
      return ">";
  }
}

/**
 * Pure client-side DBML serializer for the visible Visual Schema diagram.
 *
 * Security invariant: ONLY columns present in the governance-filtered
 * `QueryCatalog` are emitted. Hidden/restricted columns never exist in
 * `catalogTable.columns`, and any join touching a hidden table or a column
 * absent from the caller's visible catalog is omitted fail-closed.
 */
export function specToDbml(
  spec: DataRequestSpec,
  catalog: QueryCatalog | null,
): string {
  const visibleTables = spec.tables.filter((t) => !t.hidden);
  const tableById = new Map(visibleTables.map((t) => [t.id, t]));
  const catalogById = new Map<string, QueryCatalogTable>();
  const visibleColsById = new Map<string, Set<string>>();

  const blocks: string[] = [];

  for (const table of visibleTables) {
    const catTable = findCatalogTable(catalog, table.assetId);
    if (!catTable) continue;
    catalogById.set(table.id, catTable);
    const visibleCols = new Set(
      catTable.columns.map((c) => c.name.toLowerCase()),
    );
    visibleColsById.set(table.id, visibleCols);

    const header = `Table ${dbmlTableRef(catTable)} as ${quoteDbmlIdent(table.alias)} {`;
    const colLines = catTable.columns.map(
      (col) =>
        `  ${quoteDbmlIdent(col.name)} ${dbmlColumnType(col.type)}${dbmlColumnAttrs(col)}`,
    );
    blocks.push([header, ...colLines, "}"].join("\n"));
  }

  const refLines: string[] = [];
  for (const join of spec.joins) {
    const leftTable = tableById.get(join.left.tableId);
    const rightTable = tableById.get(join.right.tableId);
    if (!leftTable || !rightTable) continue;
    const leftCols = visibleColsById.get(leftTable.id);
    const rightCols = visibleColsById.get(rightTable.id);
    if (
      !leftCols?.has(join.left.column.toLowerCase()) ||
      !rightCols?.has(join.right.column.toLowerCase())
    ) {
      continue;
    }
    const leftCat = catalogById.get(leftTable.id);
    const rightCat = catalogById.get(rightTable.id);
    if (!leftCat || !rightCat) continue;

    const op = dbmlCardinalityOp(join.cardinality);
    const refName = join.constraintName
      ? ` ${quoteDbmlIdent(join.constraintName)}`
      : "";
    refLines.push(
      `Ref${refName}: ${dbmlTableRef(leftCat)}.${quoteDbmlIdent(join.left.column)} ${op} ${dbmlTableRef(rightCat)}.${quoteDbmlIdent(join.right.column)}`,
    );
  }

  if (refLines.length > 0) {
    blocks.push(refLines.join("\n"));
  }

  return blocks.join("\n\n") + (blocks.length > 0 ? "\n" : "");
}

export function exportDiagramDbml(
  spec: DataRequestSpec,
  catalog: QueryCatalog | null,
  filename = "visual-schema.dbml",
): void {
  const content = specToDbml(spec, catalog);
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
