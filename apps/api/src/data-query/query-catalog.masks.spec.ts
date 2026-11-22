import { CLS_CONNECTION_SCOPE } from './connection-scope';
import { CLS_PERSON } from '../identity/iam-access-policy';
import { QueryCatalogService } from './query-catalog.service';

/**
 * Column hide/mask in the catalog (docs/prd/DQ-data-query.md §5.8): who reads
 * a table in clear, and what everyone else's catalog and job get.
 */
const TABLE = {
  assetId: 'a-1',
  sourceId: 's-1',
  name: 'customers',
  schema: 'crm',
  table: 'customers',
  sqlName: 'lake.crm.customers',
  columns: [
    { name: 'id', type: 'BIGINT' },
    { name: 'email', type: 'VARCHAR' },
    { name: 'api_key', type: 'VARCHAR' },
    { name: 'country', type: 'VARCHAR' },
  ],
  queryable: true,
  location: { kind: 'file' },
};

function service(input: {
  capabilities?: string[];
  unmaskAssets?: string[];
  governs?: { scopeType: 'ASSET' | 'SOURCE'; scopeId: string }[];
  notes?: {
    assetId: string;
    columnName: string;
    access: string | null;
    maskKind: string | null;
    classification: string | null;
  }[];
  /** Row rules of a-1, when it filters rows. */
  rowRules?: { principalRef: string; conditions: unknown }[];
  /** Assets whose notebook declares what its columns hold (QC §5.8). */
  declared?: { id: string; metadata: unknown }[];
}) {
  const derived = [
    {
      asset_id: 'a-1',
      column: 'email',
      detector_type: 'PII',
      finding_type: 'EMAIL_ADDRESS',
    },
    {
      asset_id: 'a-1',
      column: 'api_key',
      detector_type: 'SECRETS',
      finding_type: 'AWS_KEY',
    },
  ];
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(derived),
    assetColumnAnnotation: {
      findMany: jest.fn().mockResolvedValue(input.notes ?? []),
    },
    sharedDataset: { findMany: jest.fn().mockResolvedValue([]) },
    asset: { findMany: jest.fn().mockResolvedValue(input.declared ?? []) },
    assetRowPolicy: {
      findMany: jest.fn().mockResolvedValue(
        input.rowRules
          ? [
              {
                assetId: 'a-1',
                asset: { sourceId: 's-1' },
                rules: input.rowRules,
              },
            ]
          : [],
      ),
    },
    governanceRole: {
      findMany: jest.fn(({ where }: { where: { role: unknown } }) =>
        Promise.resolve(
          typeof where.role === 'object' ? (input.governs ?? []) : [],
        ),
      ),
    },
  };
  const values: Record<string, unknown> = {
    [CLS_PERSON]: { actorRef: 'user:zephyr', groupIds: ['g-1'] },
    [CLS_CONNECTION_SCOPE]: undefined,
  };
  const cls = {
    isActive: () => true,
    get: (key: string) => values[key],
  };
  const actors = { current: () => ({ ref: 'user:zephyr', id: 'user:zephyr' }) };
  const caps = new Set(input.capabilities ?? ['data.query', 'asset.view']);
  const policy = {
    capabilities: jest.fn().mockResolvedValue(caps),
    resourceGrants: (capability: string) =>
      capability === 'data.unmask'
        ? { sourceIds: [], assetIds: input.unmaskAssets ?? [] }
        : { sourceIds: [], assetIds: [] },
  };
  const svc = new QueryCatalogService(
    prisma as never,
    cls as never,
    actors as never,
    policy as never,
  );
  jest.spyOn(svc, 'settings').mockResolvedValue({
    maxRows: 10,
    timeoutSeconds: 10,
    exportMaxRows: 10,
    updatedBy: null,
    updatedAt: null,
  });
  jest.spyOn(svc, 'tables').mockResolvedValue({
    at: Date.now(),
    sources: [
      { id: 's-1', name: 'Lake', type: 'S3', sqlName: 'lake', queryable: true },
    ],
    tables: [TABLE as never],
  });
  return { svc, prisma };
}

async function table(svc: QueryCatalogService) {
  const catalog = await svc.catalog();
  return catalog.sources[0].tables[0];
}

describe('QueryCatalogService column masks', () => {
  it('masks personal data and hides secrets by default', async () => {
    const { svc } = service({});
    const t = await table(svc);
    expect(t.columns.map((c) => [c.name, c.access ?? 'clear'])).toEqual([
      ['id', 'clear'],
      ['email', 'mask'],
      ['country', 'clear'],
    ]);
    expect(t.hiddenColumns).toBe(1);
    expect(t.masks).toEqual([
      { column: 'email', action: 'mask', mask: 'redact' },
      { column: 'api_key', action: 'hide' },
    ]);
  });

  it('masks what a notebook declares its table columns hold, never less than findings', async () => {
    const { svc } = service({
      declared: [
        {
          id: 'a-1',
          metadata: {
            query: 'scan',
            columns: [
              { name: 'country', type: 'VARCHAR', classification: 'personal' },
              // Weaker than what the findings say: the findings win.
              { name: 'email', type: 'VARCHAR', classification: 'public' },
              { name: 'id', type: 'BIGINT', classification: 'not-a-class' },
            ],
          },
        },
      ],
    });
    const t = await table(svc);
    expect(t.masks).toEqual([
      { column: 'email', action: 'mask', mask: 'redact' },
      { column: 'api_key', action: 'hide' },
      { column: 'country', action: 'mask', mask: 'redact' },
    ]);
  });

  it("follows a steward's choice over the classification", async () => {
    const { svc } = service({
      notes: [
        {
          assetId: 'a-1',
          columnName: 'email',
          access: 'clear',
          maskKind: null,
          classification: null,
        },
        {
          assetId: 'a-1',
          columnName: 'country',
          access: 'mask',
          maskKind: 'hash',
          classification: null,
        },
      ],
    });
    const t = await table(svc);
    expect(t.masks).toEqual([
      { column: 'country', action: 'mask', mask: 'hash' },
      { column: 'api_key', action: 'hide' },
    ]);
  });

  it('reads in clear with data.unmask on the workspace', async () => {
    const { svc } = service({
      capabilities: ['data.query', 'data.unmask'],
    });
    const t = await table(svc);
    expect(t.masks).toBeUndefined();
    expect(t.hiddenColumns).toBeUndefined();
    expect(t.columns.find((c) => c.name === 'api_key')).toMatchObject({
      access: 'hide',
      inClear: true,
    });
  });

  it('reads in clear with an unmasked Data reader grant on the table', async () => {
    const { svc } = service({ unmaskAssets: ['a-1'] });
    expect((await table(svc)).masks).toBeUndefined();
  });

  it('reads in clear what the person (or their group) stewards', async () => {
    const { svc, prisma } = service({
      governs: [{ scopeType: 'SOURCE', scopeId: 's-1' }],
    });
    expect((await table(svc)).masks).toBeUndefined();
    const call = prisma.governanceRole.findMany.mock.calls.find(
      ([arg]) => typeof arg.where.role === 'object',
    );
    expect(call?.[0].where).toMatchObject({
      role: { in: ['OWNER', 'STEWARD'] },
      principalRef: { in: ['user:zephyr', 'group:g-1'] },
    });
  });
});

describe('QueryCatalogService row filters (DQ §5.10)', () => {
  const region = (values: string[]) => [
    { column: 'country', op: 'in', values },
  ];

  it('reads every row of a table that does not filter rows', async () => {
    const { svc } = service({});
    expect((await table(svc)).rowFilter).toBeUndefined();
  });

  it('reads the rows of the rules for everyone and for their groups only', async () => {
    const { svc } = service({
      rowRules: [
        { principalRef: 'group:g-1', conditions: region(['AT']) },
        { principalRef: 'everyone', conditions: region(['DE']) },
        { principalRef: 'group:g-2', conditions: region(['FR']) },
      ],
    });
    expect((await table(svc)).rowFilter).toEqual({
      anyOf: [region(['AT']), region(['DE'])],
    });
  });

  it('reads no row without a rule for them', async () => {
    const { svc } = service({
      rowRules: [{ principalRef: 'group:g-2', conditions: region(['FR']) }],
    });
    expect((await table(svc)).rowFilter).toEqual({ anyOf: [] });
  });

  it('reads every row through a rule without conditions', async () => {
    const { svc } = service({
      rowRules: [{ principalRef: 'group:g-1', conditions: [] }],
    });
    expect((await table(svc)).rowFilter).toBeUndefined();
  });

  it('is not filtered on what they own or steward, even with data.unmask aside', async () => {
    const { svc } = service({
      governs: [{ scopeType: 'ASSET', scopeId: 'a-1' }],
      rowRules: [{ principalRef: 'group:g-2', conditions: region(['FR']) }],
    });
    expect((await table(svc)).rowFilter).toBeUndefined();
  });

  it('filters people who read in clear: unmasking is about columns', async () => {
    const { svc } = service({
      capabilities: ['data.query', 'data.unmask'],
      rowRules: [{ principalRef: 'group:g-1', conditions: region(['AT']) }],
    });
    const t = await table(svc);
    expect(t.masks).toBeUndefined();
    expect(t.rowFilter).toEqual({ anyOf: [region(['AT'])] });
  });

  it('lets a stored rule that no longer parses select nothing', async () => {
    const { svc } = service({
      rowRules: [{ principalRef: 'group:g-1', conditions: 'everything' }],
    });
    expect((await table(svc)).rowFilter).toEqual({ anyOf: [] });
  });
});

describe('QueryCatalogService shared dataset floors (DQ §5.12)', () => {
  function withDataset(notes: Parameters<typeof service>[0]['notes'] = []) {
    const { svc, prisma } = service({ notes });
    prisma.sharedDataset.findMany.mockResolvedValue([
      {
        assetId: 'ds-1',
        inputs: ['a-1'],
        columns: [
          {
            name: 'contact',
            type: 'VARCHAR',
            upstreams: [{ assetId: 'a-1', column: 'email' }],
            traced: true,
          },
          {
            name: 'country',
            type: 'VARCHAR',
            upstreams: [{ assetId: 'a-1', column: 'country' }],
            traced: true,
          },
          { name: 'mystery', type: 'VARCHAR', upstreams: [], traced: false },
        ],
      },
    ]);
    return svc;
  }

  it('carries the input columns’ classification to the output', async () => {
    const masks = await withDataset().columnMasks();
    expect(masks.get('ds-1')).toEqual([
      // email is personal → masked; country unclassified → clear; untraced
      // takes the strictest input column (api_key: secret) → hidden.
      { column: 'contact', action: 'mask', mask: 'redact' },
      { column: 'mystery', action: 'hide' },
    ]);
  });

  it('a steward of the dataset cannot loosen what it inherits', async () => {
    const masks = await withDataset([
      {
        assetId: 'ds-1',
        columnName: 'contact',
        access: 'clear',
        maskKind: null,
        classification: 'public',
      },
      {
        assetId: 'ds-1',
        columnName: 'country',
        access: 'hide',
        maskKind: null,
        classification: null,
      },
    ]).columnMasks();
    expect(masks.get('ds-1')).toEqual([
      { column: 'contact', action: 'mask', mask: 'redact' },
      { column: 'country', action: 'hide' },
      { column: 'mystery', action: 'hide' },
    ]);
  });
});
