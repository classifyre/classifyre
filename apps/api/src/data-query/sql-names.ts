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
import * as fs from 'fs';
import { resolveSchemaFile } from '../utils/schema-path';
import { stripLiteralsAndComments } from './sql-precheck';

/** How a table's SQL name and location are made from its asset. */
export type AddressStrategy =
  | 'postgres'
  | 'mysql'
  | 'databricks'
  | 'odbc'
  | 'catalog'
  | 'object_storage';

/** One source type's `x-query` entry (docs/prd/QC-query-connectors.md §5.1). */
export interface QueryDeclaration {
  tier: 'native' | 'extension' | 'connector' | 'custom';
  assetKinds: string[];
  address: AddressStrategy;
  extensions: string[];
}

let declarations: Map<string, QueryDeclaration> | undefined;

/**
 * Which source types can be queried and how: `x-query` in
 * packages/schemas/src/schemas/all_input_sources.json, the declaration the
 * CLI's bindings read too (apps/cli/src/query/connectors/).
 */
export function queryDeclarations(): Map<string, QueryDeclaration> {
  if (!declarations) {
    const schema = JSON.parse(
      fs.readFileSync(
        resolveSchemaFile(__dirname, 'all_input_sources.json'),
        'utf8',
      ),
    ) as { 'x-query'?: { sources?: Record<string, QueryDeclaration> } };
    declarations = new Map(
      Object.entries(schema['x-query']?.sources ?? {}).map(([type, entry]) => [
        type.toUpperCase(),
        entry,
      ]),
    );
  }
  return declarations;
}

function declarationOf(sourceType: string): QueryDeclaration | undefined {
  return queryDeclarations().get(sourceType.toUpperCase());
}

/** Source types the CLI can read: the declared ones, and shared datasets. */
export const QUERYABLE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  ...queryDeclarations().keys(),
  // Shared datasets (§5.12): not attached, but expanded into views over
  // their inputs by the API and the job.
  'SHARED_DATASET',
]);

/** Asset kinds the catalog lists: `table` for every source, and what types declare. */
export const TABLE_SHAPED_ASSET_KINDS: readonly string[] = [
  ...new Set([
    'table',
    ...[...queryDeclarations().values()].flatMap((d) => d.assetKinds),
  ]),
];

/**
 * Catalog-per-database sources (PostgreSQL's databases, Databricks'
 * catalogs, an ODBC driver's catalogs): with more than one, the database
 * joins the schema name.
 */
export function joinsDatabasesInSchema(sourceType: string): boolean {
  const address = declarationOf(sourceType)?.address;
  return (
    address === 'postgres' || address === 'databricks' || address === 'odbc'
  );
}

/** The built-in source of shared datasets (§5.12) and its SQL name. */
export const SHARED_DATASET_SOURCE_TYPE = 'SHARED_DATASET';
export const SHARED_DATASET_SQL_NAME = 'shared';

/**
 * Lakehouse formats DuckDB reads; Lance, Hudi and Paimon are not among them.
 * Keep in sync with `LAKEHOUSE_FORMATS` in apps/cli/src/query/connectors/object_storage.py.
 */
const LAKEHOUSE_FORMATS = new Set(['delta', 'iceberg']);

/**
 * File tables by MIME type: what DuckDB reads straight from a bucket.
 * The `format` values match `FILE_FORMATS` in
 * apps/cli/src/query/connectors/object_storage.py (`json` there is read via `read_json_auto`).
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
  'application/json': 'json',
  'application/geo+json': 'geojson',
  'application/vnd.flatgeobuf': 'fgb',
  'application/vnd.dbf': 'dbf',
};

const FILE_FORMATS_BY_EXTENSION: Record<string, string> = {
  parquet: 'parquet',
  csv: 'csv',
  tsv: 'tsv',
  jsonl: 'jsonl',
  ndjson: 'jsonl',
  avro: 'avro',
  json: 'json',
  geojson: 'geojson',
  fgb: 'fgb',
  dbf: 'dbf',
};

/** Names DuckDB keeps for itself, never given to a source. */
const RESERVED = new Set([
  'memory',
  'system',
  'temp',
  'main',
  'information_schema',
  'pg_catalog',
  // The built-in source of shared datasets (§5.12).
  SHARED_DATASET_SQL_NAME,
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
  | {
      kind: 'catalog';
      database?: string;
      schema?: string;
      table: string;
      /** ODBC: the table as the driver's own SQL names it, quoted. */
      qualifiedName?: string;
    }
  | { kind: 'lakehouse'; format: string; objectKey: string }
  | { kind: 'file'; format: string; objectKey: string }
  /** A shared dataset (§5.12): its SQL over its inputs, expanded per read. */
  | { kind: 'dataset'; datasetId: string };

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
  const declaration = declarationOf(sourceType);
  if (!declaration?.assetKinds.includes(assetType)) return false;
  if (declaration.address === 'object_storage') {
    return (
      assetType === 'file' &&
      !text(metadata.object_key)?.includes('#') &&
      fileFormat(metadata, name) !== undefined
    );
  }
  return true;
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
  const address = declarationOf(sourceType)?.address;

  if (address === 'postgres') {
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
  if (address === 'mysql') {
    return {
      schema: database ?? 'main',
      table: tableName,
      location: database
        ? { kind: 'catalog', database, table: tableName }
        : null,
      reason: database ? undefined : 'Scan the source again to locate it.',
    };
  }
  if (address === 'databricks') {
    // Unity Catalog: catalog.schema.table. DuckDB reads its Delta tables;
    // views have no files of their own to read.
    const catalog = text(metadata.catalog) ?? database;
    const s = schema ?? 'default';
    const isView = /view/i.test(
      text(metadata.object_type) ?? text(metadata.table_type) ?? '',
    );
    const located = Boolean(catalog && schema) && !isView;
    return {
      schema: multiDatabase && catalog ? `${catalog}_${s}` : s,
      table: tableName,
      location: located
        ? { kind: 'catalog', database: catalog, schema: s, table: tableName }
        : null,
      reason: isView
        ? 'Views in Databricks cannot be queried with SQL yet.'
        : located
          ? undefined
          : 'Scan the source again to locate it.',
    };
  }
  if (address === 'odbc') {
    // Any database behind an ODBC driver. The scan recorded the table the way
    // the driver quotes and qualifies it, so the query reads it by that name.
    const qualifiedName = text(metadata.qualified_name);
    const catalog = text(metadata.catalog);
    const s = schema ?? catalog ?? 'main';
    return {
      schema: multiDatabase && catalog ? `${catalog}_${s}` : s,
      table: tableName,
      location: qualifiedName
        ? {
            kind: 'catalog',
            database: catalog,
            schema,
            table: tableName,
            qualifiedName,
          }
        : null,
      reason: qualifiedName ? undefined : 'Scan the source again to locate it.',
    };
  }
  if (address === 'catalog') {
    return {
      schema: schema ?? 'main',
      table: tableName,
      location: schema ? { kind: 'catalog', schema, table: tableName } : null,
      reason: schema ? undefined : 'Scan the source again to locate it.',
    };
  }
  if (sourceType === SHARED_DATASET_SOURCE_TYPE) {
    const datasetId = text(metadata.dataset_id);
    return {
      schema: text(metadata.domain) ?? 'main',
      table: tableName,
      location: datasetId ? { kind: 'dataset', datasetId } : null,
      reason: datasetId ? undefined : 'This shared dataset has no definition.',
    };
  }
  if (address === 'object_storage') {
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
