import {
  assignTableNames,
  isTableShaped,
  mentionedSourceNames,
  sqlIdentifier,
  tableAddress,
  uniqueSourceSqlName,
} from './sql-names';
import { resourceGrantsInWorkspace } from '../identity/grant-evaluation';

describe('SQL names for data query', () => {
  it('makes plain lower-case identifiers', () => {
    expect(sqlIdentifier('Shop Lake · Orders')).toBe('shop_lake_orders');
    expect(sqlIdentifier('Café Orders')).toBe('cafe_orders');
    expect(sqlIdentifier('2026 exports')).toBe('t_2026_exports');
    expect(sqlIdentifier('***')).toBe('t');
  });

  it('keeps source names unique and away from DuckDB names', () => {
    const taken = new Set(['shop']);
    expect(uniqueSourceSqlName('Shop', taken)).toBe('shop_2');
    expect(uniqueSourceSqlName('memory', new Set())).toBe('memory_source');
  });

  it('locates PostgreSQL tables and keeps databases apart when there are several', () => {
    const meta = { database: 'sales', schema: 'public', table_name: 'orders' };
    expect(tableAddress('POSTGRESQL', 'table', 'x', meta)).toEqual({
      schema: 'public',
      table: 'orders',
      location: {
        kind: 'catalog',
        database: 'sales',
        schema: 'public',
        table: 'orders',
      },
      reason: undefined,
    });
    expect(tableAddress('POSTGRESQL', 'table', 'x', meta, true).schema).toBe(
      'sales_public',
    );
  });

  it('reads Delta and Iceberg in buckets, and says why Lance cannot be', () => {
    const delta = tableAddress('S3_COMPATIBLE_STORAGE', 'table', 'orders', {
      object_key: 'shop/orders',
      table_format: 'delta',
    });
    expect(delta.location).toEqual({
      kind: 'lakehouse',
      format: 'delta',
      objectKey: 'shop/orders',
    });
    expect([delta.schema, delta.table]).toEqual(['shop', 'orders']);

    const iceberg = tableAddress('LOCAL_FOLDER', 'table', 'c', {
      object_key: 'tables/iceberg_contacts',
      table_format: 'iceberg',
      table_version: '00004-abc',
    });
    // Read as it is now: the scan's version is not passed on.
    expect(iceberg.location).toEqual({
      kind: 'lakehouse',
      format: 'iceberg',
      objectKey: 'tables/iceberg_contacts',
    });

    const lance = tableAddress('S3_COMPATIBLE_STORAGE', 'table', 'p', {
      object_key: 'tables/people.lance',
      table_format: 'lance',
    });
    expect(lance.location).toBeNull();
    expect(lance.reason).toMatch(/lance/);
  });

  it('treats table files in buckets as tables, but not embedded members', () => {
    expect(
      isTableShaped(
        'S3_COMPATIBLE_STORAGE',
        'file',
        { mime_type: 'text/csv' },
        'a.csv',
      ),
    ).toBe(true);
    expect(
      isTableShaped(
        'S3_COMPATIBLE_STORAGE',
        'file',
        { object_key: 'a.zip#b.csv', mime_type: 'text/csv' },
        'b.csv',
      ),
    ).toBe(false);
    expect(
      isTableShaped(
        'S3_COMPATIBLE_STORAGE',
        'file',
        { mime_type: 'application/pdf' },
        'a.pdf',
      ),
    ).toBe(false);
    const file = tableAddress('S3_COMPATIBLE_STORAGE', 'file', 'x', {
      object_key: 'shop/exports/orders_2026_10.parquet',
      mime_type: 'application/parquet',
    });
    expect([file.schema, file.table]).toEqual([
      'shop_exports',
      'orders_2026_10',
    ]);
    expect(file.location).toEqual({
      kind: 'file',
      format: 'parquet',
      objectKey: 'shop/exports/orders_2026_10.parquet',
    });
  });

  it('reads JSON and geo files from a bucket', () => {
    const cases: Array<[string, string, string]> = [
      ['files/data.json', 'application/json', 'json'],
      ['geo/boundaries.geojson', 'application/geo+json', 'geojson'],
      ['geo/sites.fgb', 'application/vnd.flatgeobuf', 'fgb'],
      ['geo/parcels.dbf', 'application/vnd.dbf', 'dbf'],
    ];
    for (const [key, mime, format] of cases) {
      const address = tableAddress('S3_COMPATIBLE_STORAGE', 'file', key, {
        object_key: key,
        mime_type: mime,
      });
      expect(address.location).toEqual({
        kind: 'file',
        format,
        objectKey: key,
      });
      // The extension alone is enough when the scan left no mime type.
      expect(
        tableAddress('S3_COMPATIBLE_STORAGE', 'file', key, { object_key: key })
          .location,
      ).toMatchObject({ format });
    }
    // Formats DuckDB cannot read stay out.
    for (const key of [
      'people.orc',
      'people.arrow',
      'app.sqlite',
      'w.duckdb',
      'staff.xlsx',
      'places.gpkg',
      'people.vortex',
    ]) {
      expect(
        tableAddress('S3_COMPATIBLE_STORAGE', 'file', key, { object_key: key })
          .location,
      ).toBeNull();
    }
  });

  it('addresses Databricks tables by catalog, schema and table', () => {
    const meta = {
      catalog: 'sales',
      database: 'sales',
      schema: 'raw',
      table_name: 'orders',
      object_type: 'TABLE',
    };
    expect(tableAddress('DATABRICKS', 'table', 'x', meta)).toEqual({
      schema: 'raw',
      table: 'orders',
      location: {
        kind: 'catalog',
        database: 'sales',
        schema: 'raw',
        table: 'orders',
      },
      reason: undefined,
    });
    // Several catalogs: the catalog joins the schema so names stay apart.
    expect(tableAddress('DATABRICKS', 'table', 'x', meta, true).schema).toBe(
      'sales_raw',
    );
    // A view has no files of its own.
    const view = tableAddress('DATABRICKS', 'table', 'v', {
      ...meta,
      object_type: 'VIEW',
    });
    expect(view.location).toBeNull();
    expect(view.reason).toMatch(/views/i);
  });

  it('gives colliding tables stable suffixes by asset id', () => {
    const names = assignTableNames([
      { id: 'b', schema: 'Shop', table: 'Orders' },
      { id: 'a', schema: 'shop', table: 'orders' },
    ]);
    expect(names.get('a')).toEqual({ schema: 'shop', table: 'orders' });
    expect(names.get('b')).toEqual({ schema: 'shop', table: 'orders_2' });
  });

  it('finds the sources a query mentions, quoted or not', () => {
    const found = mentionedSourceNames(
      'SELECT * FROM shop.public.a JOIN "lake" . x.y ON 1=1 -- not_shop.z',
      ['shop', 'lake', 'other'],
    );
    expect([...found].sort()).toEqual(['lake', 'shop']);
  });

  it('ignores sources named only in literals or comments', () => {
    const found = mentionedSourceNames(
      "SELECT 'shop.public.a' AS s FROM lake.x.y /* other.z.w */ -- shop.q.r",
      ['shop', 'lake', 'other'],
    );
    expect([...found]).toEqual(['lake']);
  });
});

describe('resource grants', () => {
  const grant = (
    scopeType: 'source' | 'asset' | 'workspace',
    scopeId: string,
    roleKey = 'data-reader',
  ) => ({
    scopeType,
    scopeId,
    roleKey,
  });

  it('opens only the granted sources and tables of the workspace', () => {
    const grants = resourceGrantsInWorkspace(
      [
        grant('source', 'ws1/src-a'),
        grant('asset', 'ws1/asset-b'),
        grant('asset', 'ws2/asset-c'),
        grant('asset', 'ws1/asset-d', 'viewer'),
        grant('workspace', 'ws1'),
      ],
      'ws1',
      'data.query',
    );
    expect(grants).toEqual({ sourceIds: ['src-a'], assetIds: ['asset-b'] });
  });
});
