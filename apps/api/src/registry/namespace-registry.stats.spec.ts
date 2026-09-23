import {
  classifyStatsSource,
  NamespaceRegistryService,
  type NamespaceStatsSourceRow,
} from './namespace-registry.service';

function buildService(sourceRows: NamespaceStatsSourceRow[]) {
  const query = jest.fn((sql: string) => {
    if (sql.includes('FROM namespaces')) {
      return Promise.resolve({
        rows: [
          {
            id: 'ns-1',
            name: 'Acme',
            slug: 'acme',
            schema_name: 'ns_1',
            description: null,
            has_thumbnail: false,
            paused: false,
            paused_at: null,
            paused_reason: null,
            settings: {},
            external_links: [],
            created_at: new Date(0),
            updated_at: new Date(0),
            last_opened_at: null,
          },
        ],
        rowCount: 1,
      });
    }
    if (sql.includes('namespace_category_members')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Promise.resolve({ rows: sourceRows, rowCount: sourceRows.length });
  });

  const service = new NamespaceRegistryService();
  // The service owns a real pg Pool built in a field initialiser; swap it for
  // the stub rather than opening a connection in a unit test.
  (service as unknown as { pool: unknown }).pool = { query, end: jest.fn() };
  return service;
}

describe('classifyStatsSource', () => {
  const originalUrl = process.env.DATABASE_URL;
  beforeAll(() => {
    process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/test';
  });
  afterAll(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it.each([
    // A scan waiting for a free slot reads as pending, never as running.
    [{ runnerStatus: 'RUNNING', latestRunnerStatus: 'PENDING' }, 'pending'],
    [{ runnerStatus: 'RUNNING', latestRunnerStatus: 'RUNNING' }, 'running'],
    // Claimed without a run row yet (repair has not caught up).
    [{ runnerStatus: 'RUNNING', latestRunnerStatus: null }, 'running'],
    [{ runnerStatus: 'PENDING', latestRunnerStatus: null }, 'pending'],
    [{ runnerStatus: 'ERROR', latestRunnerStatus: 'ERROR' }, 'failing'],
    [{ runnerStatus: 'ERROR', latestRunnerStatus: null }, 'failing'],
    [{ runnerStatus: 'COMPLETED', latestRunnerStatus: 'COMPLETED' }, null],
    [{ runnerStatus: 'WARNING', latestRunnerStatus: 'WARNING' }, null],
    [{ runnerStatus: 'STOPPED', latestRunnerStatus: 'STOPPED' }, null],
  ] as Array<[NamespaceStatsSourceRow, 'failing' | 'running' | 'pending' | null]>)(
    'classifies %j as %s',
    (row, expected) => {
      expect(classifyStatsSource(row)).toBe(expected);
    },
  );
});

describe('NamespaceRegistryService stats', () => {
  const originalUrl = process.env.DATABASE_URL;
  beforeAll(() => {
    process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/test';
  });
  afterAll(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it('counts a queued scan as pending rather than running', async () => {
    const service = buildService([
      // One actively scanning, one waiting for a free slot.
      { runnerStatus: 'RUNNING', latestRunnerStatus: 'RUNNING' },
      { runnerStatus: 'RUNNING', latestRunnerStatus: 'PENDING' },
      { runnerStatus: 'PENDING', latestRunnerStatus: null },
      { runnerStatus: 'ERROR', latestRunnerStatus: 'ERROR' },
      { runnerStatus: 'COMPLETED', latestRunnerStatus: 'COMPLETED' },
    ]);

    const [stats] = await service.stats();

    expect(stats).toEqual({
      id: 'ns-1',
      totalSources: 5,
      failingSources: 1,
      runningSources: 1,
      pendingSources: 2,
    });
  });

  it('degrades to zeroes when the tenant schema is missing', async () => {
    const service = new NamespaceRegistryService();
    (service as unknown as { pool: unknown }).pool = {
      query: jest.fn((sql: string) => {
        if (sql.includes('FROM namespaces')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.reject(new Error('missing schema'));
      }),
      end: jest.fn(),
    };

    await expect(service.stats()).resolves.toEqual([]);
  });
});
