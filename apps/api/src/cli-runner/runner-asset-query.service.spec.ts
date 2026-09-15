import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { RunnerStatus } from '@prisma/client';

import type { PrismaService } from '../prisma.service';
import {
  ASSET_QUERY_CALLS_PER_RUN,
  RunnerAssetQueryService,
} from './runner-asset-query.service';

type Row = {
  id: string;
  hash: string;
  name: string;
  kind: string;
  url: string;
  externalId: string | null;
  selected: Record<string, unknown> | null;
};

const row = (id: string): Row => ({
  id,
  hash: `hash-${id}`,
  name: `Company ${id}`,
  kind: 'record',
  url: `https://example.com/${id}`,
  externalId: `FN-${id}`,
  selected: { legal_form_code: 'GES' },
});

describe('RunnerAssetQueryService', () => {
  let rows: Row[];
  let tx: { $executeRaw: jest.Mock; $queryRaw: jest.Mock };
  let prisma: {
    runner: { findUnique: jest.Mock };
    source: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: RunnerAssetQueryService;

  const body = (over: Record<string, unknown> = {}) => ({
    source: 'Firmenbuch Register',
    kind: 'record',
    where: { legal_form_code: { in: ['GES', 'AG'] }, filing_count: { gt: 0 } },
    excludeVisited: { key: 'firmenbuchnummer', sinceDays: 90 },
    select: ['legal_form_code'],
    limit: 2,
    ...over,
  });

  /** The SQL text of the one data query, placeholders as "?". */
  const querySql = (): string => {
    const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    // Nested Prisma.Sql fragments carry their own text; flatten for asserting.
    return strings
      .map(
        (part, index) =>
          part +
          (index < values.length
            ? typeof values[index] === 'object' &&
              values[index] !== null &&
              'sql' in values[index]
              ? (values[index] as { sql: string }).sql
              : '?'
            : ''),
      )
      .join('');
  };

  beforeEach(() => {
    rows = [row('1'), row('2'), row('3')];
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn(() => Promise.resolve(rows)),
    };
    prisma = {
      runner: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-fin',
          status: RunnerStatus.RUNNING,
          sourceId: 'src-financials',
        }),
      },
      source: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'src-register', name: 'Firmenbuch Register' },
          ]),
      },
      $transaction: jest.fn((callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
    };
    service = new RunnerAssetQueryService(prisma as unknown as PrismaService);
  });

  it('pages a cohort: limit rows, a cursor while more remain', async () => {
    const page = await service.query('run-fin', body());

    expect(page.items).toEqual([
      {
        assetHash: 'hash-1',
        externalId: 'FN-1',
        name: 'Company 1',
        kind: 'record',
        url: 'https://example.com/1',
        metadata: { legal_form_code: 'GES' },
      },
      expect.objectContaining({ assetHash: 'hash-2' }),
    ]);
    expect(page.nextCursor).toBe('2');
    expect(page.callsRemaining).toBe(ASSET_QUERY_CALLS_PER_RUN - 1);

    rows = [row('3')];
    const last = await service.query('run-fin', body({ cursor: '2' }));
    expect(last.nextCursor).toBeNull();
  });

  it('bounds the query in time and keeps the planner off nested loops', async () => {
    await service.query('run-fin', body());

    const sets = tx.$executeRaw.mock.calls.map((call: unknown[]) =>
      (call[0] as string[]).join(''),
    );
    expect(sets).toEqual([
      "SET LOCAL statement_timeout = '15s'",
      'SET LOCAL enable_nestloop = off',
    ]);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 20_000,
      maxWait: 5_000,
    });
  });

  it('reads one source, live assets, and anti-joins what the caller scanned', async () => {
    await service.query('run-fin', body());
    const sql = querySql();

    expect(sql).toContain('a.source_id = ?');
    expect(sql).toContain(`a.status <> 'DELETED'::"AssetStatus"`);
    expect(sql).toContain('a.asset_type = ?');
    expect(sql).toContain('NOT EXISTS (');
    expect(sql).toContain('v.source_id = ?');
    expect(sql).toContain(
      '(v.metadata #>> ?::text[]) = (a.metadata #>> ?::text[])',
    );
    expect(sql).toContain('ORDER BY a.id');
    const values = tx.$queryRaw.mock.calls[0].slice(1);
    expect(values).toContain(3); // limit + 1, to know whether more remain
  });

  it('refuses a run that is not RUNNING, so finished credentials read nothing', async () => {
    prisma.runner.findUnique.mockResolvedValue({
      id: 'run-fin',
      status: RunnerStatus.COMPLETED,
      sourceId: 'src-financials',
    });
    await expect(service.query('run-fin', body())).rejects.toBeInstanceOf(
      ConflictException,
    );
    prisma.runner.findUnique.mockResolvedValue(null);
    await expect(service.query('run-x', body())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('stops a run at its call budget', async () => {
    for (let call = 0; call < ASSET_QUERY_CALLS_PER_RUN; call += 1) {
      await service.query('run-fin', body());
    }
    await expect(service.query('run-fin', body())).rejects.toMatchObject({
      status: 429,
    } as Partial<HttpException>);
  });

  it('asks for an id when a source name is ambiguous', async () => {
    prisma.source.findMany.mockResolvedValue([
      { id: 'a', name: 'Register' },
      { id: 'b', name: 'Register' },
    ]);
    await expect(
      service.query('run-fin', body({ source: 'Register' })),
    ).rejects.toThrow(/pass its id/);
  });

  it.each([
    [{ source: '' }, /source is required/],
    [{ limit: 5001 }, /limit must be/],
    [{ select: Array.from({ length: 21 }, (_, i) => `k${i}`) }, /select/],
    [{ excludeVisited: { key: 'fn', sinceDays: 0 } }, /excludeVisited/],
    [{ where: { fn: { like: 'x' } } }, /Unknown operator/],
    [{ kind: 'record; drop' }, /kind must be/],
  ])('rejects %p before touching the database', async (over, message) => {
    await expect(service.query('run-fin', body(over))).rejects.toThrow(message);
    expect(prisma.runner.findUnique).not.toHaveBeenCalled();
  });

  it('turns a statement timeout into advice rather than a 500', async () => {
    tx.$queryRaw.mockRejectedValue(
      Object.assign(new Error('canceling statement due to statement timeout'), {
        meta: { code: '57014' },
      }),
    );
    await expect(service.query('run-fin', body())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
