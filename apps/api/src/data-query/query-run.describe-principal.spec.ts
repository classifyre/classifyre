import { QueryRunStatus } from '@prisma/client';
import { groupPrincipal, type DataPrincipal } from './data-principal';
import { QueryRunService } from './query-run.service';

function makeDescribeService(describePayload: unknown) {
  const catalogSpy = jest.fn((_principal?: DataPrincipal) =>
    Promise.resolve({
      canQueryAll: false,
      limits: {},
      sources: [
        {
          id: 's1',
          name: 'Lake',
          type: 'POSTGRESQL',
          sqlName: 'lake',
          queryable: true,
          tables: [
            {
              assetId: 'a1',
              sourceId: 's1',
              name: 'orders',
              schema: 'sales',
              table: 'orders',
              sqlName: 'lake.sales.orders',
              columns: [{ name: 'id', type: 'INTEGER' }],
              queryable: true,
              canQuery: true,
              location: { kind: 'table' },
            },
          ],
        },
      ],
    }),
  );

  const createdRuns: Record<string, unknown>[] = [];
  const prisma = {
    queryRun: {
      count: jest.fn(() => Promise.resolve(0)),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        createdRuns.push(data);
        return Promise.resolve({ id: 'run-desc-1', ...data });
      }),
      update: jest.fn(() => Promise.resolve({})),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      findUnique: jest.fn(() =>
        Promise.resolve({
          status: QueryRunStatus.SUCCESS,
          error: null,
          result: Buffer.from(JSON.stringify(describePayload), 'utf8'),
        }),
      ),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    source: {
      findMany: jest.fn(() =>
        Promise.resolve([{ id: 's1', type: 'POSTGRESQL', config: {} }]),
      ),
    },
  };

  const catalog = {
    settings: jest.fn(() =>
      Promise.resolve({
        maxRows: 100,
        timeoutSeconds: 30,
        exportMaxRows: 1000,
      }),
    ),
    catalog: catalogSpy,
  };

  const cliRunner = {
    queryCallbackBaseUrl: () => 'http://api/ws-1',
    runQueryExecution: jest.fn(() =>
      Promise.resolve({ output: '', exitCode: 0 }),
    ),
    cancelQueryExecution: jest.fn(() => Promise.resolve()),
  };

  const actor = {
    id: 'user:alice',
    ref: 'user:alice',
    via: 'oidc',
    kind: 'person',
    displayName: 'Alice',
  };

  const service = new QueryRunService(
    prisma as never,
    catalog as never,
    cliRunner as never,
    { decryptMaskedConfig: (c: unknown) => c } as never,
    { current: () => actor, workspaceId: () => 'ws-1' } as never,
    { record: jest.fn(() => Promise.resolve()) } as never,
    { check: jest.fn(() => Promise.resolve({ allow: true })) } as never,
    { resolve: jest.fn(() => Promise.resolve({ datasets: [] })) } as never,
  );

  return { service, catalogSpy, createdRuns };
}

describe('QueryRunService.describe principal forwarding', () => {
  const payload = {
    columns: [{ name: 'id', type: 'INTEGER' }],
    lineage: [],
    tables: ['lake.sales.orders'],
  };

  it('forwards the group principal passed to describe(sql, { principal }) into catalog.catalog(principal)', async () => {
    const { service, catalogSpy, createdRuns } = makeDescribeService(payload);
    const principal = groupPrincipal({
      groupId: 'grp-data',
      lineage: ['grp-data', 'grp-org'],
      capabilities: new Set(['data.query', 'dataset.publish']),
      resourceGrants: {
        'data.query': { sourceIds: ['s1'], assetIds: ['a1'] },
      },
    });

    const result = await service.describe('SELECT id FROM lake.sales.orders', {
      principal,
    });

    expect(catalogSpy).toHaveBeenCalledTimes(1);
    expect(catalogSpy).toHaveBeenCalledWith(principal);
    expect(result).toEqual({ description: payload });
    // Run ownership stays with the signed-in actor for rate caps and audit.
    expect(createdRuns[0]).toMatchObject({
      actorRef: 'user:alice',
      personRef: 'user:alice',
    });
  });

  it('calls catalog.catalog(undefined) when no principal override is passed', async () => {
    const { service, catalogSpy } = makeDescribeService(payload);

    const result = await service.describe('SELECT id FROM lake.sales.orders');

    expect(catalogSpy).toHaveBeenCalledTimes(1);
    expect(catalogSpy).toHaveBeenCalledWith(undefined);
    expect(result).toEqual({ description: payload });
  });
});
