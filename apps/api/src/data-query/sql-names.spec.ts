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
