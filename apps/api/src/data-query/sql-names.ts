/**
 * How SQL names a workspace's tables, and where each one lives
 * (docs/prd/DQ-data-query.md §5). Pure functions, so the catalog, the run
 * service and their specs agree on every name.
 *
 * A table is `<source>.<schema>.<table>`: the source's `sqlName`, then a
 * schema and a table taken from the asset's metadata. Every part is a plain
 * lower-case identifier, so nobody has to quote anything and the CLI's SQL
 * gate can compare names exactly.
 */
import { stripLiteralsAndComments } from './sql-precheck';

/**
 * Source types the CLI can attach or scan with DuckDB.
 *
 * Keep in sync with `QUERYABLE_SOURCE_TYPES` in
 * apps/cli/src/query/bindings.py (same eight values); the API names them,
 * the job attaches them.
 */
export const QUERYABLE_SOURCE_TYPES = new Set([
  'POSTGRESQL',
  'MYSQL',
  'ICEBERG_REST',
  'DUCKLAKE',
  'S3_COMPATIBLE_STORAGE',
  'AZURE_BLOB_STORAGE',
  'GOOGLE_CLOUD_STORAGE',
  'LOCAL_FOLDER',
]);

const OBJECT_STORAGE_TYPES = new Set([
  'S3_COMPATIBLE_STORAGE',
  'AZURE_BLOB_STORAGE',
  'GOOGLE_CLOUD_STORAGE',
  'LOCAL_FOLDER',
]);

/**
 * Lakehouse formats DuckDB reads; Lance, Hudi and Paimon are not among them.
 * Keep in sync with `LAKEHOUSE_FORMATS` in apps/cli/src/query/bindings.py.
 */
const LAKEHOUSE_FORMATS = new Set(['delta', 'iceberg']);

/**
 * File tables by MIME type: what DuckDB reads straight from a bucket.
 * The `format` values match `FILE_FORMATS` in
 * apps/cli/src/query/bindings.py (`json` there is read via `read_json_auto`).
 */
const FILE_FORMATS: Record<string, string> = {
  'application/parquet': 'parquet',
  'application/vnd.apache.parquet': 'parquet',
  'application/x-parquet': 'parquet',
  'text/csv': 'csv',
  'application/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/x-ndjson': 'jsonl',
  'application/jsonl': 'jsonl',
  'application/x-jsonlines': 'jsonl',
  'application/avro': 'avro',
  'application/vnd.apache.avro': 'avro',
};

const FILE_FORMATS_BY_EXTENSION: Record<string, string> = {
  parquet: 'parquet',
  csv: 'csv',
  tsv: 'tsv',
  jsonl: 'jsonl',
  ndjson: 'jsonl',
  avro: 'avro',
};

/** Names DuckDB keeps for itself, never given to a source. */
const RESERVED = new Set([
  'memory',
  'system',
  'temp',
  'main',
  'information_schema',
  'pg_catalog',
]);

/** A plain lower-case SQL identifier made from any text. */
export function sqlIdentifier(text: string, fallback = 't'): string {
  let id = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!id) id = fallback;
  if (/^[0-9]/.test(id)) id = `${fallback}_${id}`;
  return id.slice(0, 63);
}

/** A source name for SQL, unique among `taken`. */
export function uniqueSourceSqlName(name: string, taken: Set<string>): string {
  let base = sqlIdentifier(name, 'source');
  if (RESERVED.has(base)) base = `${base}_source`;
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) {
    candidate = `${base.slice(0, 58)}_${n}`;
  }
  return candidate;
}

/** Where a table lives, as the CLI's bindings read it. */
export type TableLocation =
  | { kind: 'catalog'; database?: string; schema?: string; table: string }
  | { kind: 'lakehouse'; format: string; objectKey: string }
  | { kind: 'file'; format: string; objectKey: string };

export interface TableAddress {
  /** Unsanitised, before collisions are resolved. */
  schema: string;
  table: string;
  location: TableLocation | null;
  /** Why the table cannot be queried, when it cannot. */
  reason?: string;
}

type Metadata = Record<string, unknown>;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function fileFormat(metadata: Metadata, name: string): string | undefined {
  const mime = text(metadata.mime_type)?.toLowerCase();
  if (mime && FILE_FORMATS[mime]) return FILE_FORMATS[mime];
  const extension = (text(metadata.object_key) ?? name)
    .split('.')
    .pop()
    ?.toLowerCase();
  return extension ? FILE_FORMATS_BY_EXTENSION[extension] : undefined;
}

/** True when an asset of a queryable source is a table SQL could read. */
export function isTableShaped(
  sourceType: string,
  assetType: string,
  metadata: Metadata,
  name: string,
): boolean {
  if (assetType === 'table') return true;
  return (
    OBJECT_STORAGE_TYPES.has(sourceType) &&
    assetType === 'file' &&
    !text(metadata.object_key)?.includes('#') &&
    fileFormat(metadata, name) !== undefined
  );
}

/** Split an object key into a schema (its folders) and a table (its last part). */
function keyParts(key: string, stripExtension: boolean): [string, string] {
  const parts = key.split('/').filter(Boolean);
  let table = parts.pop() ?? key;
  if (stripExtension) table = table.replace(/\.[^.]+$/, '');
  return [parts.length ? parts.join('_') : 'root', table];
}

/**
 * The schema, table and location of one asset. `multiDatabase` is true when
 * a database source's tables come from more than one database, so the
 * database joins the schema name to keep names apart.
 */
export function tableAddress(
  sourceType: string,
  assetType: string,
  name: string,
  metadata: Metadata,
  multiDatabase = false,
): TableAddress {
  const database = text(metadata.database);
  const schema = text(metadata.schema) ?? text(metadata.namespace);
  const tableName = text(metadata.table_name) ?? name;

  if (sourceType === 'POSTGRESQL') {
    const s = schema ?? 'public';
    return {
      schema: multiDatabase && database ? `${database}_${s}` : s,
      table: tableName,
      location: database
        ? { kind: 'catalog', database, schema: s, table: tableName }
        : null,
      reason: database ? undefined : 'Scan the source again to locate it.',
    };
  }
  if (sourceType === 'MYSQL') {
    return {
      schema: database ?? 'main',
      table: tableName,
      location: database
        ? { kind: 'catalog', database, table: tableName }
        : null,
      reason: database ? undefined : 'Scan the source again to locate it.',
    };
  }
  if (sourceType === 'ICEBERG_REST' || sourceType === 'DUCKLAKE') {
    return {
      schema: schema ?? 'main',
      table: tableName,
      location: schema ? { kind: 'catalog', schema, table: tableName } : null,
      reason: schema ? undefined : 'Scan the source again to locate it.',
    };
  }
  if (OBJECT_STORAGE_TYPES.has(sourceType)) {
    const key = text(metadata.object_key) ?? name;
    if (assetType === 'table') {
      const format = (text(metadata.table_format) ?? '').toLowerCase();
      const [s, t] = keyParts(key, false);
      if (!LAKEHOUSE_FORMATS.has(format)) {
        return {
          schema: s,
          table: t,
          location: null,
          reason: `${format || 'This'} tables cannot be queried with SQL yet.`,
        };
      }
      // No version: a query reads the table as it is now, not as the last
      // scan saw it (the job finds the newest Iceberg metadata itself).
      return {
        schema: s,
        table: t,
        location: { kind: 'lakehouse', format, objectKey: key },
      };
    }
    const format = fileFormat(metadata, name);
    const [s, t] = keyParts(key, true);
    return {
      schema: s,
      table: t,
      location: format ? { kind: 'file', format, objectKey: key } : null,
      reason: format ? undefined : 'This file type cannot be queried.',
    };
  }
  return {
    schema: schema ?? 'main',
    table: tableName,
    location: null,
    reason: 'Sources of this type cannot be queried with SQL yet.',
  };
}

/**
 * Turn raw schema/table pairs into unique identifiers, in a stable order:
 * the first asset (by id) keeps the plain name, later ones get `_2`, `_3`.
 */
export function assignTableNames<
  T extends { id: string; schema: string; table: string },
>(tables: T[]): Map<string, { schema: string; table: string }> {
  const names = new Map<string, { schema: string; table: string }>();
  const taken = new Set<string>();
  for (const entry of [...tables].sort((a, b) => a.id.localeCompare(b.id))) {
    const schema = sqlIdentifier(entry.schema, 's');
    const base = sqlIdentifier(entry.table, 't');
    let table = base;
    for (let n = 2; taken.has(`${schema}.${table}`); n++) {
      table = `${base.slice(0, 58)}_${n}`;
    }
    taken.add(`${schema}.${table}`);
    names.set(entry.id, { schema, table });
  }
  return names;
}

/**
 * The sources whose SQL name the executable code mentions as `<name>.`
 * (quoted or not). Literals and comments are blanked first, so a source
 * named inside a string never causes its recipe to leave the API
 * (docs/prd/DQ-data-query.md §5.4 "only the recipes of their sources").
 */
export function mentionedSourceNames(sql: string, names: Iterable<string>) {
  const lower = stripLiteralsAndComments(sql).toLowerCase();
  const found = new Set<string>();
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^a-z0-9_"])"?${escaped}"?\\s*\\.`, 'i');
    if (pattern.test(lower)) found.add(name);
  }
  return found;
}
