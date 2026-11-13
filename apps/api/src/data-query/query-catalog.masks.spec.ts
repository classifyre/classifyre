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
    governanceRole: {
      findMany: jest.fn(({ where }: { where: { role: unknown } }) =>
        Promise.resolve(
          typeof where.role === 'object' ? (input.governs ?? []) : [],
        ),
      ),
    },
  };
  const values: Record<string, unknown> = {
    [CLS_PERSON]: { actorRef: 'user:ana', groupIds: ['g-1'] },
    [CLS_CONNECTION_SCOPE]: undefined,
  };
  const cls = {
    isActive: () => true,
    get: (key: string) => values[key],
  };
  const actors = { current: () => ({ ref: 'user:ana', id: 'user:ana' }) };
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
      principalRef: { in: ['user:ana', 'group:g-1'] },
    });
  });
});
