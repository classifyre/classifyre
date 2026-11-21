/**
 * The `x-query` declaration drives what the API names and offers for SQL
 * (docs/prd/QC-query-connectors.md §5.1). The CLI's twin is
 * apps/cli/tests/test_query_manifest.py; together they keep the catalog and
 * the query job agreeing on which tables can be read.
 */
import {
  QUERYABLE_SOURCE_TYPES,
  SHARED_DATASET_SOURCE_TYPE,
  TABLE_SHAPED_ASSET_KINDS,
  isTableShaped,
  joinsDatabasesInSchema,
  queryDeclarations,
  tableAddress,
} from './sql-names';

const UNQUERYABLE = 'Sources of this type cannot be queried with SQL yet.';

/** Metadata a scan records, enough for every address strategy to locate a table. */
const LOCATED = {
  database: 'sales',
  catalog: 'sales',
  schema: 'raw',
  table_name: 'orders',
  qualified_name: '"raw"."orders"',
  object_key: 'lake/orders',
  table_format: 'delta',
  mime_type: 'application/parquet',
};

describe('x-query declaration', () => {
  const declared = queryDeclarations();

  it('declares the ten source types DQ built', () => {
    expect([...declared.keys()].sort()).toEqual(
      [
        'AZURE_BLOB_STORAGE',
        'DATABRICKS',
        'DUCKLAKE',
        'GOOGLE_CLOUD_STORAGE',
        'ICEBERG_REST',
        'LOCAL_FOLDER',
        'MYSQL',
        'ODBC',
        'POSTGRESQL',
        'S3_COMPATIBLE_STORAGE',
      ].sort(),
    );
  });

  it('makes exactly the declared types queryable, plus shared datasets', () => {
    expect(new Set(QUERYABLE_SOURCE_TYPES)).toEqual(
      new Set([...declared.keys(), SHARED_DATASET_SOURCE_TYPE]),
    );
  });

  it.each([...queryDeclarations().entries()])(
    '%s: every declared kind is table-shaped and located',
    (type, declaration) => {
      expect(declaration.assetKinds.length).toBeGreaterThan(0);
      for (const kind of declaration.assetKinds) {
        expect(TABLE_SHAPED_ASSET_KINDS).toContain(kind);
        expect(isTableShaped(type, kind, LOCATED, 'orders.parquet')).toBe(true);
        const address = tableAddress(type, kind, 'orders.parquet', LOCATED);
        expect(address.reason).not.toBe(UNQUERYABLE);
        expect(address.location).not.toBeNull();
      }
    },
  );

  it('still lists the tables of an undeclared source, locked', () => {
    expect(isTableShaped('TRINO', 'table', {}, 'orders')).toBe(true);
    expect(isTableShaped('TRINO', 'file', {}, 'orders.csv')).toBe(false);
    expect(tableAddress('TRINO', 'table', 'orders', {}).reason).toBe(
      UNQUERYABLE,
    );
  });

  it('joins the database into the schema only for catalog-per-database sources', () => {
    expect(joinsDatabasesInSchema('POSTGRESQL')).toBe(true);
    expect(joinsDatabasesInSchema('DATABRICKS')).toBe(true);
    expect(joinsDatabasesInSchema('ODBC')).toBe(true);
    expect(joinsDatabasesInSchema('MYSQL')).toBe(false);
    expect(joinsDatabasesInSchema('S3_COMPATIBLE_STORAGE')).toBe(false);
  });
});
