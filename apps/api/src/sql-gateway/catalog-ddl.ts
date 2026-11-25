import { createHash } from 'node:crypto';
import type { CatalogSource } from '../data-query/query-catalog.service';
import { DEFAULT_MASK } from '../data-query/column-masks';
import { ddlType } from './pg-types';

/** PostgreSQL's identifier limit (NAMEDATALEN - 1), in bytes. */
const MAX_IDENT = 63;

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const quoteLiteral = (text: string) => `'${text.replace(/'/g, "''")}'`;

export interface CatalogDdl {
  /** Canonical CREATE SCHEMA/TABLE/COMMENT statements for the catalog database. */
  sql: string;
  /** PostgreSQL schema names that hold tables (`<source>.<schema>`). */
  dataSchemas: Set<string>;
  tables: number;
  /** Tables left out because a name is longer than PostgreSQL allows. */
  skipped: string[];
}

export interface CatalogNotes {
  /** asset id → its description (GOV). */
  tables: Map<string, string>;
  /** asset id → column → business name and description (GOV). */
  columns: Map<
    string,
    Map<string, { businessName: string | null; description: string | null }>
  >;
}

/**
 * Opaque 24-hex hash identifying a `(workspace, effective catalog)` database
 * on the catalog sidecar (docs/prd/SG-sql-gateway-native-catalog.md §4.2).
 *
 * Database names (`c_<hash>`) and roles (`r_<hash>`) never reveal workspace,
 * tenant, or user names, while connections with identical effective views in
 * the same workspace share a single immutable catalog database.
 */
export function computeCatalogHash(
  workspaceId: string,
  canonicalCatalogDdlSql: string,
): string {
  return createHash('sha256')
    .update(`v1\0${workspaceId}\0${canonicalCatalogDdlSql}`)
    .digest('hex')
    .slice(0, 24);
}

/**
 * The catalog a SQL connection shows (docs/prd/DQ-data-query.md §5.7): one
 * PostgreSQL schema per source schema, named `<source>.<schema>` so the
 * `source.schema.table` the SQL page uses reads as `"source.schema".table`,
 * and one empty table per table the person may query, with the column types
 * the scan recorded and the business names and descriptions governance gave
 * them as comments — BI tools show those.
 *
 * Output is canonically sorted by source and table name so identical effective
 * access views always hash to the same catalog database.
 */
export function catalogDdl(
  sources: CatalogSource[],
  notes?: CatalogNotes,
): CatalogDdl {
  const statements: string[] = [];
  const dataSchemas = new Set<string>();
  const skipped: string[] = [];
  let tables = 0;
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  const sortedSources = [...sources].sort((a, b) =>
    a.sqlName.localeCompare(b.sqlName),
  );
  for (const source of sortedSources) {
    const sortedTables = [...source.tables].sort(
      (a, b) =>
        a.schema.localeCompare(b.schema) || a.table.localeCompare(b.table),
    );
    for (const table of sortedTables) {
      if (!table.canQuery) continue;
      const schema = `${source.sqlName}.${table.schema}`;
      if (bytes(schema) > MAX_IDENT || bytes(table.table) > MAX_IDENT) {
        skipped.push(table.sqlName);
        continue;
      }
      if (!dataSchemas.has(schema)) {
        dataSchemas.add(schema);
        statements.push(`CREATE SCHEMA ${quoteIdent(schema)};`);
        statements.push(
          `COMMENT ON SCHEMA ${quoteIdent(schema)} IS ${quoteLiteral(`${source.name} · ${table.schema}`)};`,
        );
      }
      const seen = new Set<string>();
      const columns = table.columns
        .filter((c) => {
          const key = c.name.toLowerCase();
          if (!c.name || bytes(c.name) > MAX_IDENT || seen.has(key))
            return false;
          seen.add(key);
          return true;
        })
        .map((c) => `${quoteIdent(c.name)} ${ddlType(c.type)}`);
      const name = `${quoteIdent(schema)}.${quoteIdent(table.table)}`;
      statements.push(`CREATE TABLE ${name} (${columns.join(', ')});`);
      const description = notes?.tables.get(table.assetId);
      statements.push(
        `COMMENT ON TABLE ${name} IS ${quoteLiteral(
          description ? `${table.name} — ${description}` : table.name,
        )};`,
      );
      const columnNotes = notes?.columns.get(table.assetId);
      for (const column of table.columns) {
        if (!seen.has(column.name.toLowerCase())) continue;
        const note = columnNotes?.get(column.name);
        // A masked column says so: BI tools show comments next to columns.
        const masked =
          column.access === 'mask' && !column.inClear
            ? `Masked (${column.mask ?? DEFAULT_MASK})`
            : null;
        const text = [note?.businessName, note?.description, masked]
          .filter(Boolean)
          .join(' — ');
        if (text) {
          statements.push(
            `COMMENT ON COLUMN ${name}.${quoteIdent(column.name)} IS ${quoteLiteral(text)};`,
          );
        }
      }
      tables += 1;
    }
  }
  return { sql: statements.join('\n'), dataSchemas, tables, skipped };
}
