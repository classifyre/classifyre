import {
  DATA_REQUEST_MAX_SOURCES,
  DATA_REQUEST_MAX_TABLES,
  DataRequestSpecSchema,
  EMPTY_DATA_REQUEST_SPEC,
  generateRequestSql,
  quoteSqlIdent,
  specToSketch,
  suggestTableAlias,
  type DataRequestSpec,
  type DataRequestTable,
  type RequestTableMeta,
} from '@workspace/schemas/data-request';
import { BoardSketchSchema } from '@workspace/schemas/case-board';
import { precheckSql } from '../data-query/sql-precheck';

function table(
  overrides: Partial<DataRequestTable> &
    Pick<DataRequestTable, 'id' | 'sqlName' | 'alias'>,
): DataRequestTable {
  return {
    assetId: `asset-${overrides.id}`,
    x: 0,
    y: 0,
    keep: ['id'],
    filters: [],
    ...overrides,
  };
}

function spec(partial: Partial<DataRequestSpec>): DataRequestSpec {
  return {
    tables: [],
    joins: [],
    pins: [],
    groups: [],
    ...partial,
  };
}

describe('quoteSqlIdent & suggestTableAlias', () => {
  it('leaves plain lowercase identifiers unquoted and quotes mixed case or reserved words', () => {
    expect(quoteSqlIdent('customer_id')).toBe('customer_id');
    expect(quoteSqlIdent('_internal2')).toBe('_internal2');
    expect(quoteSqlIdent('CustomerId')).toBe('"CustomerId"');
    expect(quoteSqlIdent('order')).toBe('"order"');
    expect(quoteSqlIdent('user')).toBe('"user"');
    expect(quoteSqlIdent('first name')).toBe('"first name"');
    expect(quoteSqlIdent('a"b')).toBe('"a""b"');
  });

  it('suggests deterministic non-colliding table aliases', () => {
    const taken = new Set<string>();
    expect(suggestTableAlias('lake.crm.customers', taken)).toBe('c');
    taken.add('c');
    expect(suggestTableAlias('lake.crm.contacts', taken)).toBe('contacts');
    taken.add('contacts');
    expect(suggestTableAlias('lake.crm.contacts', taken)).toBe('c2');
  });
});

describe('generateRequestSql', () => {
  it('writes unquoted 3-part table names, quotes mixed-case & reserved columns, and formats deterministically', () => {
    const s = spec({
      tables: [
        table({
          id: 't1',
          sqlName: 'lake.crm.customers',
          alias: 'c',
          keep: ['id', 'CustomerName', 'order', 'user'],
        }),
      ],
    });
    const first = generateRequestSql(s);
    const second = generateRequestSql(s);

    expect(first.diagnostics).toEqual([]);
    expect(first.sql).toBe(second.sql);
    expect(first.sql).toBe(
      [
        'SELECT',
        '  c.id,',
        '  c."CustomerName",',
        '  c."order",',
        '  c."user"',
        'FROM lake.crm.customers c',
      ].join('\n'),
    );
    expect(first.sql).not.toContain('"lake"');
    expect(first.sql).not.toContain('"crm"');
    expect(first.sql).not.toContain('"customers"');
  });

  it('orders joins by BFS from spec.tables[0] and puts visited side on left of ON', () => {
    const s = spec({
      tables: [
        table({
          id: 'a',
          sqlName: 'lake.crm.accounts',
          alias: 'a',
          keep: ['account_id'],
        }),
        table({
          id: 'b',
          sqlName: 'lake.crm.orders',
          alias: 'b',
          keep: ['order_id'],
        }),
        table({
          id: 'c',
          sqlName: 'lake.crm.invoices',
          alias: 'c',
          keep: ['invoice_id'],
        }),
        table({
          id: 'd',
          sqlName: 'lake.crm.line_items',
          alias: 'd',
          keep: ['item_id'],
        }),
      ],
      joins: [
        // d connects to b (depth 2) — listed first to verify BFS still visits b & c before d
        {
          id: 'j-bd',
          left: { tableId: 'd', column: 'order_id' },
          right: { tableId: 'b', column: 'order_id' },
          type: 'INNER',
        },
        {
          id: 'j-ab',
          left: { tableId: 'b', column: 'account_id' },
          right: { tableId: 'a', column: 'account_id' },
          type: 'INNER',
        },
        {
          id: 'j-ac',
          left: { tableId: 'a', column: 'account_id' },
          right: { tableId: 'c', column: 'account_id' },
          type: 'LEFT',
        },
      ],
    });

    const result = generateRequestSql(s);
    expect(result.diagnostics).toEqual([]);
    expect(result.sql).toBe(
      [
        'SELECT',
        '  a.account_id,',
        '  b.order_id,',
        '  c.invoice_id,',
        '  d.item_id',
        'FROM lake.crm.accounts a',
        'INNER JOIN lake.crm.orders b',
        '  ON a.account_id = b.account_id',
        'LEFT JOIN lake.crm.invoices c',
        '  ON a.account_id = c.account_id',
        'INNER JOIN lake.crm.line_items d',
        '  ON b.order_id = d.order_id',
      ].join('\n'),
    );
  });

  it('combines multiple joins between the same pair into a single ON ... AND ... and supports LEFT join', () => {
    const s = spec({
      tables: [
        table({
          id: 'o',
          sqlName: 'lake.sales.orders',
          alias: 'o',
          keep: ['tenant_id'],
        }),
        table({
          id: 'c',
          sqlName: 'lake.sales.customers',
          alias: 'c',
          keep: ['name'],
        }),
      ],
      joins: [
        {
          id: 'j1',
          left: { tableId: 'o', column: 'tenant_id' },
          right: { tableId: 'c', column: 'tenant_id' },
          type: 'LEFT',
        },
        {
          id: 'j2',
          left: { tableId: 'o', column: 'customer_id' },
          right: { tableId: 'c', column: 'id' },
          type: 'LEFT',
        },
      ],
    });

    const result = generateRequestSql(s);
    expect(result.diagnostics).toEqual([]);
    expect(result.sql).toBe(
      [
        'SELECT',
        '  o.tenant_id,',
        '  c.name',
        'FROM lake.sales.orders o',
        'LEFT JOIN lake.sales.customers c',
        '  ON o.tenant_id = c.tenant_id',
        '  AND o.customer_id = c.id',
      ].join('\n'),
    );
  });

  it('refuses a disconnected table with an error and empty SQL', () => {
    const s = spec({
      tables: [
        table({
          id: 't1',
          sqlName: 'lake.crm.customers',
          alias: 'c',
          keep: ['id'],
        }),
        table({
          id: 't2',
          sqlName: 'lake.crm.orders',
          alias: 'o',
          keep: ['total'],
        }),
      ],
      joins: [],
    });

    const result = generateRequestSql(s);
    expect(result.sql).toBe('');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        level: 'error',
        code: 'disconnected_table',
        tableId: 't2',
      }),
    );
  });

  it('errors when more than 12 tables are placed', () => {
    const tables = Array.from({ length: DATA_REQUEST_MAX_TABLES + 1 }, (_, i) =>
      table({
        id: `t${i}`,
        sqlName: `lake.crm.tbl_${i}`,
        alias: `t${i}`,
        keep: ['id'],
      }),
    );
    const joins = tables.slice(1).map((t, idx) => ({
      id: `j${idx}`,
      left: { tableId: 't0', column: 'id' },
      right: { tableId: t.id, column: 'id' },
      type: 'INNER' as const,
    }));

    const result = generateRequestSql(spec({ tables, joins }));
    expect(result.sql).toBe('');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        level: 'error',
        code: 'too_many_tables',
      }),
    );
  });

  it('errors when more than 8 distinct sources are referenced', () => {
    const tables = Array.from(
      { length: DATA_REQUEST_MAX_SOURCES + 1 },
      (_, i) =>
        table({
          id: `t${i}`,
          sqlName: `src_${i}.public.tbl`,
          alias: `s${i}`,
          keep: ['id'],
        }),
    );
    const joins = tables.slice(1).map((t, idx) => ({
      id: `j${idx}`,
      left: { tableId: 't0', column: 'id' },
      right: { tableId: t.id, column: 'id' },
      type: 'INNER' as const,
    }));

    const result = generateRequestSql(spec({ tables, joins }));
    expect(result.sql).toBe('');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        level: 'error',
        code: 'too_many_sources',
      }),
    );
  });

  it('formats filters: string escaping, numeric coercion, booleans, IN, and IS NULL', () => {
    const lookup: Record<string, RequestTableMeta> = {
      'asset-c': {
        sqlName: 'lake.crm.customers',
        exists: true,
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'last_name', type: 'VARCHAR' },
          { name: 'score', type: 'DOUBLE' },
          { name: 'is_active', type: 'BOOLEAN' },
          { name: 'country', type: 'VARCHAR' },
          { name: 'deleted_at', type: 'TIMESTAMP' },
        ],
      },
    };
    const s = spec({
      tables: [
        table({
          id: 'c',
          sqlName: 'lake.crm.customers',
          alias: 'c',
          keep: ['id', 'last_name'],
          filters: [
            { column: 'last_name', op: '=', value: "O'Brien" },
            { column: 'score', op: '>=', value: '42.5' },
            { column: 'id', op: '>', value: 10 },
            { column: 'is_active', op: '=', value: true },
            { column: 'country', op: 'IN', values: ['DE', "Côte d'Ivoire"] },
            { column: 'deleted_at', op: 'IS NULL' },
          ],
        }),
      ],
    });

    const result = generateRequestSql(s, lookup);
    expect(result.diagnostics).toEqual([]);
    expect(result.sql).toBe(
      [
        'SELECT',
        '  c.id,',
        '  c.last_name',
        'FROM lake.crm.customers c',
        'WHERE',
        "  c.last_name = 'O''Brien'",
        '  AND c.score >= 42.5',
        '  AND c.id > 10',
        '  AND c.is_active = TRUE',
        "  AND c.country IN ('DE', 'Côte d''Ivoire')",
        '  AND c.deleted_at IS NULL',
      ].join('\n'),
    );
  });

  it('errors on invalid numeric filter value and returns empty SQL', () => {
    const lookup: Record<string, RequestTableMeta> = {
      'asset-c': {
        sqlName: 'lake.crm.customers',
        exists: true,
        columns: [{ name: 'amount', type: 'DECIMAL(10,2)' }],
      },
    };
    const s = spec({
      tables: [
        table({
          id: 'c',
          sqlName: 'lake.crm.customers',
          alias: 'c',
          keep: ['amount'],
          filters: [{ column: 'amount', op: '>', value: 'not-a-number' }],
        }),
      ],
    });

    const result = generateRequestSql(s, lookup);
    expect(result.sql).toBe('');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        level: 'error',
        code: 'invalid_filter_value',
        tableId: 'c',
        column: 'amount',
      }),
    );
  });

  it('disambiguates colliding output column names with <alias>_<col>', () => {
    const s = spec({
      tables: [
        table({
          id: 'c',
          sqlName: 'lake.crm.customers',
          alias: 'c',
          keep: ['id', 'email', 'UpdatedAt'],
        }),
        table({
          id: 'o',
          sqlName: 'lake.crm.orders',
          alias: 'o',
          keep: ['id', 'total', 'UpdatedAt'],
        }),
      ],
      joins: [
        {
          id: 'j1',
          left: { tableId: 'c', column: 'id' },
          right: { tableId: 'o', column: 'customer_id' },
          type: 'INNER',
        },
      ],
    });

    const result = generateRequestSql(s);
    expect(result.diagnostics).toEqual([]);
    expect(result.sql).toContain('  c.id AS c_id,');
    expect(result.sql).toContain('  c.email,');
    expect(result.sql).toContain('  c."UpdatedAt" AS "c_UpdatedAt",');
    expect(result.sql).toContain('  o.id AS o_id,');
    expect(result.sql).toContain('  o.total,');
    expect(result.sql).toContain('  o."UpdatedAt" AS "o_UpdatedAt"');
  });

  it('reports table_missing when a table is absent or marked exists: false in lookup', () => {
    const lookup = new Map<string, RequestTableMeta>([
      ['asset-t1', { sqlName: 'lake.crm.customers', exists: false }],
    ]);
    const s = spec({
      tables: [
        table({
          id: 't1',
          sqlName: 'lake.crm.customers',
          alias: 'c',
          keep: ['id'],
        }),
        table({
          id: 't2',
          sqlName: 'lake.crm.orders',
          alias: 'o',
          keep: ['id'],
        }),
      ],
      joins: [
        {
          id: 'j1',
          left: { tableId: 't1', column: 'id' },
          right: { tableId: 't2', column: 'customer_id' },
          type: 'INNER',
        },
      ],
    });

    const result = generateRequestSql(s, lookup);
    expect(result.sql).toBe('');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          code: 'table_missing',
          tableId: 't1',
        }),
        expect.objectContaining({
          level: 'error',
          code: 'table_missing',
          tableId: 't2',
        }),
      ]),
    );
  });

  it('round-trips generated SQL through precheckSql with no refusal', () => {
    const s = spec({
      tables: [
        table({
          id: 'c',
          sqlName: 'lake.crm.customers',
          alias: 'c',
          keep: ['id', 'CustomerName', 'order'],
          filters: [{ column: 'CustomerName', op: 'ILIKE', value: "O'Brien%" }],
        }),
        table({
          id: 'o',
          sqlName: 'lake.crm.orders',
          alias: 'o',
          keep: ['id', 'total'],
          filters: [{ column: 'total', op: '>=', value: 100 }],
        }),
      ],
      joins: [
        {
          id: 'j1',
          left: { tableId: 'c', column: 'id' },
          right: { tableId: 'o', column: 'customer_id' },
          type: 'LEFT',
        },
      ],
    });

    const lookup: Record<string, RequestTableMeta> = {
      'asset-c': {
        sqlName: 'lake.crm.customers',
        exists: true,
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'CustomerName', type: 'VARCHAR' },
          { name: 'order', type: 'INTEGER' },
        ],
      },
      'asset-o': {
        sqlName: 'lake.crm.orders',
        exists: true,
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'customer_id', type: 'INTEGER' },
          { name: 'total', type: 'NUMERIC' },
        ],
      },
    };

    const { sql, diagnostics } = generateRequestSql(s, lookup);
    expect(diagnostics).toEqual([]);
    expect(sql).not.toBe('');

    const allowed = new Set(['lake.crm.customers', 'lake.crm.orders']);
    const sources = new Set(['lake']);
    expect(precheckSql(sql, allowed, sources)).toBeNull();
  });

  it('rejects unknown keys in DataRequestSpecSchema and defaults groups to []', () => {
    expect(
      DataRequestSpecSchema.safeParse({
        tables: [],
        joins: [],
        pins: [],
        unexpected: true,
      }).success,
    ).toBe(false);

    const parsed = DataRequestSpecSchema.parse({
      tables: [],
      joins: [],
      pins: [],
    });
    expect(parsed.groups).toEqual([]);
  });

  it('parses v1 specs without visual fields and ignores visual fields in generated SQL', () => {
    const baseSpec = DataRequestSpecSchema.parse({
      tables: [
        {
          id: 'c',
          assetId: 'asset-c',
          sqlName: 'lake.crm.customers',
          alias: 'c',
          x: 0,
          y: 0,
          keep: ['id', 'email'],
        },
        {
          id: 'o',
          assetId: 'asset-o',
          sqlName: 'lake.crm.orders',
          alias: 'o',
          x: 320,
          y: 0,
          keep: ['total'],
        },
      ],
      joins: [
        {
          id: 'j1',
          left: { tableId: 'c', column: 'id' },
          right: { tableId: 'o', column: 'customer_id' },
        },
      ],
      pins: [],
    });

    const visualSpec = DataRequestSpecSchema.parse({
      ...baseSpec,
      tables: [
        {
          ...baseSpec.tables[0],
          color: 'amber',
          height: 360,
          collapsed: true,
          hidden: true,
        },
        {
          ...baseSpec.tables[1],
          color: 'violet',
          height: 240,
        },
      ],
      joins: [
        {
          ...baseSpec.joins[0],
          cardinality: '1-N',
          constraintName: 'fk_orders_customer',
          origin: 'fk',
        },
      ],
      groups: [
        {
          id: 'g1',
          label: 'Billing',
          x: -20,
          y: -40,
          w: 680,
          h: 420,
          color: 'green',
        },
      ],
    });

    expect(generateRequestSql(visualSpec)).toEqual(
      generateRequestSql(baseSpec),
    );
  });

  it('emits RIGHT JOIN and FULL OUTER JOIN deterministically and passes precheckSql', () => {
    const s = spec({
      tables: [
        table({
          id: 'a',
          sqlName: 'lake.crm.accounts',
          alias: 'a',
          keep: ['id'],
        }),
        table({
          id: 'b',
          sqlName: 'lake.crm.orders',
          alias: 'b',
          keep: ['total'],
        }),
        table({
          id: 'c',
          sqlName: 'lake.crm.invoices',
          alias: 'c',
          keep: ['amount'],
        }),
      ],
      joins: [
        {
          id: 'j1',
          left: { tableId: 'a', column: 'id' },
          right: { tableId: 'b', column: 'account_id' },
          type: 'RIGHT',
          cardinality: '1-N',
          origin: 'fk',
        },
        {
          id: 'j2',
          left: { tableId: 'b', column: 'id' },
          right: { tableId: 'c', column: 'order_id' },
          type: 'FULL',
          cardinality: '1-1',
          origin: 'manual',
        },
      ],
    });

    const result = generateRequestSql(s);
    expect(result.diagnostics).toEqual([]);
    expect(result.sql).toBe(
      [
        'SELECT',
        '  a.id,',
        '  b.total,',
        '  c.amount',
        'FROM lake.crm.accounts a',
        'RIGHT JOIN lake.crm.orders b',
        '  ON a.id = b.account_id',
        'FULL OUTER JOIN lake.crm.invoices c',
        '  ON b.id = c.order_id',
      ].join('\n'),
    );
    expect(
      precheckSql(
        result.sql,
        new Set(['lake.crm.accounts', 'lake.crm.orders', 'lake.crm.invoices']),
        new Set(['lake']),
      ),
    ).toBeNull();
  });
});

describe('specToSketch', () => {
  it('returns null for an empty spec', () => {
    expect(specToSketch(EMPTY_DATA_REQUEST_SPEC)).toBeNull();
  });

  it('builds a valid BoardSketch with matching table/pin node counts and deduplicated edges', () => {
    const s = spec({
      tables: [
        table({
          id: 'c',
          sqlName: 'lake.crm.customers',
          alias: 'c',
          x: 40,
          y: 60,
          keep: ['id', 'email', 'country'],
        }),
        table({
          id: 'o',
          sqlName: 'lake.crm.orders',
          alias: 'o',
          x: 340,
          y: 120,
          keep: ['id', 'total'],
        }),
      ],
      joins: [
        {
          id: 'j1',
          left: { tableId: 'c', column: 'id' },
          right: { tableId: 'o', column: 'customer_id' },
          type: 'INNER',
        },
        {
          id: 'j2',
          left: { tableId: 'c', column: 'tenant_id' },
          right: { tableId: 'o', column: 'tenant_id' },
          type: 'INNER',
        },
      ],
      pins: [
        {
          threadId: 'th-1',
          anchor: { tableId: 'c', column: 'email' },
          x: 150,
          y: 90,
        },
      ],
    });

    const sketch = specToSketch(s);
    expect(sketch).not.toBeNull();
    expect(sketch!.nodes).toHaveLength(3);
    expect(sketch!.nodes.filter((n) => n.t === 'h')).toHaveLength(2);
    expect(sketch!.nodes.filter((n) => n.t === 'p')).toHaveLength(1);
    expect(sketch!.edges).toHaveLength(1);
    expect(sketch!.edges[0]).toEqual({ a: 0, b: 1, t: 'l' });

    const validated = BoardSketchSchema.safeParse(sketch);
    expect(validated.success).toBe(true);
  });

  it('marks LEFT join edges with style "s" and still validates against BoardSketchSchema', () => {
    const s = spec({
      tables: [
        table({
          id: 'a',
          sqlName: 'lake.crm.a',
          alias: 'a',
          x: -100,
          y: -50,
          keep: ['id'],
        }),
        table({
          id: 'b',
          sqlName: 'lake.crm.b',
          alias: 'b',
          x: 200,
          y: 100,
          keep: ['id'],
        }),
      ],
      joins: [
        {
          id: 'j1',
          left: { tableId: 'a', column: 'id' },
          right: { tableId: 'b', column: 'a_id' },
          type: 'LEFT',
        },
      ],
    });

    const sketch = specToSketch(s);
    expect(sketch).not.toBeNull();
    expect(sketch!.edges).toEqual([{ a: 0, b: 1, t: 's' }]);
    expect(BoardSketchSchema.safeParse(sketch).success).toBe(true);
  });

  it('uses neutral or swatch colors (never #0284c7) and omits hidden tables', () => {
    const s = spec({
      tables: [
        table({
          id: 'a',
          sqlName: 'lake.crm.customers',
          alias: 'a',
          x: 0,
          y: 0,
          keep: ['id'],
        }),
        table({
          id: 'b',
          sqlName: 'lake.crm.orders',
          alias: 'b',
          x: 260,
          y: 0,
          keep: ['id'],
          color: 'amber',
        }),
        table({
          id: 'c',
          sqlName: 'lake.crm.hidden_tbl',
          alias: 'c',
          x: 520,
          y: 0,
          keep: ['id'],
          hidden: true,
        }),
      ],
      joins: [
        {
          id: 'j1',
          left: { tableId: 'a', column: 'id' },
          right: { tableId: 'b', column: 'customer_id' },
          type: 'RIGHT',
        },
        {
          id: 'j2',
          left: { tableId: 'b', column: 'id' },
          right: { tableId: 'c', column: 'order_id' },
          type: 'INNER',
        },
      ],
    });

    const sketch = specToSketch(s);
    expect(sketch).not.toBeNull();
    expect(sketch!.nodes).toHaveLength(2);
    expect(sketch!.nodes[0]).toMatchObject({ t: 'h', c: '#0a0a0a' });
    expect(sketch!.nodes[1]).toMatchObject({ t: 'h', c: '#d97706' });
    expect(JSON.stringify(sketch)).not.toContain('#0284c7');
    expect(sketch!.edges).toEqual([{ a: 0, b: 1, t: 's' }]);
    expect(BoardSketchSchema.safeParse(sketch).success).toBe(true);

    // All tables hidden and no pins → null
    expect(
      specToSketch(
        spec({
          tables: [
            table({
              id: 'only',
              sqlName: 'lake.crm.only',
              alias: 'o',
              hidden: true,
            }),
          ],
        }),
      ),
    ).toBeNull();
  });
});
