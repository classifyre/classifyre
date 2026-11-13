import { QueryRunStatus } from '@prisma/client';
import { QueryRunService, runOrigin } from './query-run.service';

const table = (sqlName: string, assetId: string) => ({
  assetId,
  sourceId: 's1',
  name: assetId,
  schema: 'public',
  table: assetId,
  sqlName,
  columns: [],
  queryable: true,
  canQuery: true,
  location: { kind: 'table' },
});

function setup(options: { active?: number; result?: Buffer | null } = {}) {
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const order: string[] = [];
  const prisma = {
    queryRun: {
      count: () => Promise.resolve(options.active ?? 0),
      create: ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ id: 'run-1', ...data });
      },
      update: ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return Promise.resolve({});
      },
      updateMany: ({ data }: { data: Record<string, unknown> }) => {
        order.push(`status:${String(data.status)}`);
        return Promise.resolve({ count: 1 });
      },
      findUnique: () =>
        Promise.resolve({
          status: QueryRunStatus.SUCCESS,
          error: null,
          result:
            options.result === undefined
              ? Buffer.from('arrow')
              : options.result,
          truncated: false,
          select: undefined,
        }),
      deleteMany: () => Promise.resolve({ count: 0 }),
    },
    source: {
      findMany: () =>
        Promise.resolve([{ id: 's1', type: 'POSTGRESQL', config: {} }]),
    },
  };
  const catalog = {
    settings: () =>
      Promise.resolve({ maxRows: 10, timeoutSeconds: 30, exportMaxRows: 100 }),
    catalog: () =>
      Promise.resolve({
        canQueryAll: false,
        limits: {},
        sources: [
          {
            id: 's1',
            name: 'Shop',
            type: 'POSTGRESQL',
            sqlName: 'shop',
            queryable: true,
            tables: [table('shop.public.orders', 'a1')],
          },
        ],
      }),
  };
  const cliRunner = {
    queryCallbackBaseUrl: () => 'http://api/ns',
    runQueryExecution: () => Promise.resolve({ output: '', exitCode: 0 }),
    cancelQueryExecution: () => {
      order.push('cancel-job');
      return Promise.resolve();
    },
  };
  const actor = {
    id: 'user:ana',
    ref: 'user:ana@sql:conn-1',
    via: 'sql-connection',
    kind: 'person',
    displayName: null,
  };
  const service = new QueryRunService(
    prisma as never,
    catalog as never,
    cliRunner as never,
    { decryptMaskedConfig: (c: unknown) => c } as never,
    { current: () => actor, workspaceId: () => 'ns' } as never,
    { record: () => Promise.resolve() } as never,
    { check: () => Promise.resolve({ allow: true }) } as never,
  );
  return { service, created, updates, order };
}

const input = (tables: string[]) => ({
  sql: 'SELECT 1',
  tables,
  database: 'lab',
  searchPath: [],
  maxRows: 10,
});

describe('runOrigin', () => {
  it('counts the person and names the channel', () => {
    expect(
      runOrigin({
        id: 'user:a',
        ref: 'user:a@sql:c1',
        via: 'sql-connection',
        kind: 'person',
        displayName: null,
      }),
    ).toEqual({
      actorRef: 'user:a@sql:c1',
      personRef: 'user:a',
      channel: 'sql',
      connectionId: 'c1',
    });
    expect(
      runOrigin({
        id: 'user:a',
        ref: 'user:a@mcp:t',
        via: 'mcp-token',
        kind: 'person',
        displayName: null,
      }),
    ).toMatchObject({
      personRef: 'user:a',
      channel: 'mcp',
      connectionId: null,
    });
    expect(
      runOrigin({
        id: 'user:a',
        ref: 'user:a',
        via: 'oidc',
        kind: 'person',
        displayName: null,
      }),
    ).toMatchObject({ personRef: 'user:a', channel: 'rest' });
  });
});

describe('QueryRunService for SQL connections', () => {
  it('refuses at the person’s cap', async () => {
    const { service, created } = setup({ active: 3 });
    const result = await service.createForConnection(
      input(['shop.public.orders']),
    );
    expect(result).toMatchObject({
      refused: { code: 'too_many_queries', sqlState: '53000' },
    });
    expect(created).toHaveLength(0);
  });

  it('refuses tables the catalog does not give this connection', async () => {
    const { service } = setup();
    const result = await service.createForConnection(
      input(['shop.public.secret']),
    );
    expect(result).toMatchObject({
      refused: { code: 'table_not_available', sqlState: '42501' },
    });
  });

  it('records the run as the connection’s and settles done when the job ends', async () => {
    const { service, created } = setup();
    const result = await service.createForConnection(
      input(['shop.public.orders']),
    );
    expect('runId' in result).toBe(true);
    if (!('runId' in result)) return;
    await expect(result.done).resolves.toBeUndefined();
    expect(created[0]).toMatchObject({
      personRef: 'user:ana',
      channel: 'sql',
      connectionId: 'conn-1',
      assetIds: ['a1'],
    });
  });

  it('hands out a result once and drops it', async () => {
    const { service, updates } = setup();
    const taken = await service.takeConnectionResult('run-1');
    expect(taken.arrow?.toString()).toBe('arrow');
    expect(updates).toContainEqual({ result: null });
  });

  it('marks a cancel before stopping the job', async () => {
    const { service, order } = setup();
    await service.cancelConnectionRun('run-1');
    expect(order).toEqual([`status:${QueryRunStatus.CANCELLED}`, 'cancel-job']);
  });
});
