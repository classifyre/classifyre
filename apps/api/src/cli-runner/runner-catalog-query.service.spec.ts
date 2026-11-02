import { BadRequestException, ConflictException } from '@nestjs/common';
import { RunnerStatus } from '@prisma/client';

import type { PrismaService } from '../prisma.service';
import { RunnerCatalogQueryService } from './runner-catalog-query.service';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

describe('RunnerCatalogQueryService', () => {
  let rows: Array<Record<string, unknown>>;
  let tx: { $executeRaw: jest.Mock; $queryRaw: jest.Mock };
  let prisma: { runner: { findUnique: jest.Mock }; $transaction: jest.Mock };
  let service: RunnerCatalogQueryService;

  const sqlOf = (): string => {
    const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    return strings
      .map(
        (part, index) =>
          part +
          (index < values.length
            ? values[index] &&
              typeof values[index] === 'object' &&
              'sql' in values[index]
              ? (values[index] as { sql: string }).sql
              : '?'
            : ''),
      )
      .join('');
  };

  beforeEach(() => {
    rows = [{ id: UUID_A }, { id: UUID_B }, { id: UUID_C }];
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn(() => Promise.resolve(rows)),
    };
    prisma = {
      runner: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-1',
          status: RunnerStatus.RUNNING,
          sourceId: 'src-1',
        }),
      },
      $transaction: jest.fn((callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
    };
    service = new RunnerCatalogQueryService(prisma as unknown as PrismaService);
  });

  it('pages sources by cursor and never selects configuration', async () => {
    const date = new Date('2026-11-01T00:00:00Z');
    rows = [UUID_A, UUID_B, UUID_C].map((id) => ({
      id,
      name: id,
      type: 'POSTGRESQL',
      description: null,
      runnerStatus: 'COMPLETED',
      createdAt: date,
      updatedAt: date,
    }));
    const page = await service.sources('run-1', { limit: 2 });
    expect(page.items.map((item) => item.id)).toEqual([UUID_A, UUID_B]);
    expect(page.nextCursor).toBe(UUID_B);
    expect(page.items[0]).not.toHaveProperty('config');
    expect(sqlOf()).not.toMatch(/config|masked/i);
  });

  it('never reads a detector pipeline, only its type', async () => {
    rows = [];
    await service.detectors('run-1', {});
    expect(sqlOf()).toContain("pipeline_schema->>'type'");
    expect(sqlOf()).not.toMatch(/SELECT[^]*d\.pipeline_schema\s*(,|AS|FROM)/);
  });

  it('filters findings by detector and defaults to OPEN', async () => {
    rows = [];
    await service.findings('run-1', { customDetectorKey: ['qa-flag'] });
    const sql = sqlOf();
    expect(sql).toContain('f.custom_detector_key = ANY');
    const values = (tx.$queryRaw.mock.calls[0] as unknown[])
      .slice(1)
      .flatMap((v) =>
        v && typeof v === 'object' && 'values' in v
          ? (v as { values: unknown[] }).values
          : [v],
      );
    expect(values).toContainEqual(['OPEN']);
  });

  it('refuses a run that is not RUNNING and bad cursors and limits', async () => {
    prisma.runner.findUnique.mockResolvedValue({
      id: 'run-1',
      status: RunnerStatus.COMPLETED,
      sourceId: 's',
    });
    await expect(service.sources('run-1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    prisma.runner.findUnique.mockResolvedValue({
      id: 'run-1',
      status: RunnerStatus.RUNNING,
      sourceId: 's',
    });
    await expect(
      service.findings('run-1', { cursor: 'nope' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.findings('run-1', { limit: 5001 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.findings('run-1', { severity: ['LOUD'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
