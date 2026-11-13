import type { CatalogSource } from '../data-query/query-catalog.service';
import { ddlType } from './pg-types';

/** PostgreSQL's identifier limit (NAMEDATALEN - 1), in bytes. */
const MAX_IDENT = 63;

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const quoteLiteral = (text: string) => `'${text.replace(/'/g, "''")}'`;

export interface CatalogDdl {
  /** CREATE SCHEMA/TABLE/COMMENT statements for the session's PGlite. */
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
 * The catalog a SQL connection shows (docs/prd/DQ-data-query.md §5.7): one
 * PostgreSQL schema per source schema, named `<source>.<schema>` so the
 * `source.schema.table` the SQL page uses reads as `"source.schema".table`,
 * and one empty table per table the person may query, with the column types
 * the scan recorded and the business names and descriptions governance gave
 * them as comments — BI tools show those.
 */
export function catalogDdl(
  sources: CatalogSource[],
  notes?: CatalogNotes,
  username?: string,
): CatalogDdl {
  const statements: string[] = [];
  const dataSchemas = new Set<string>();
  const skipped: string[] = [];
  let tables = 0;
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  for (const source of sources) {
    for (const table of source.tables) {
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
        const text = [note?.businessName, note?.description]
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
  if (username) {
    // The session runs as the connection, read-only: clients show the right
    // user, and writes fail with "permission denied" rather than succeeding
    // on the empty catalog tables.
    const role = quoteIdent(username);
    statements.push(`CREATE ROLE ${role} LOGIN;`);
    statements.push(`GRANT USAGE ON SCHEMA classifyre TO ${role};`);
    statements.push(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA classifyre TO ${role};`,
    );
    for (const schema of dataSchemas) {
      statements.push(
        `GRANT USAGE ON SCHEMA ${quoteIdent(schema)} TO ${role};`,
      );
      statements.push(
        `GRANT SELECT ON ALL TABLES IN SCHEMA ${quoteIdent(schema)} TO ${role};`,
      );
    }
    statements.push(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;`);
    statements.push(`SET SESSION AUTHORIZATION ${role};`);
  }
  return { sql: statements.join('\n'), dataSchemas, tables, skipped };
}
