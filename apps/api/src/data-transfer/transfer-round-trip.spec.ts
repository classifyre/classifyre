import { DataTransferConflict, type DataTransferJob } from '@prisma/client';
import { Readable } from 'node:stream';

import { ArchiveReader } from './archive';
import { ArchiveStoreService } from './archive-store.service';
import { NamespaceExportService } from './namespace-export.service';
import { NamespaceImportService } from './namespace-import.service';
import { MASKED_CONFIG_ENCRYPTED_PREFIX } from '../utils/masked-config.utils';
import type { PrismaService } from '../prisma.service';

/**
 * Exercises the real export and import services against in-memory tables.
 *
 * The fake delegates implement just enough Prisma to be honest about the two
 * behaviours these services actually depend on: keyset pagination (so the
 * export's cursor walk is really tested, not stubbed past) and an all-or-nothing
 * `createMany` that rejects a batch on a dangling reference (so the import's
 * row-by-row fallback is really reached).
 */

// ── In-memory Prisma double ──────────────────────────────────────────────────

interface FakeTable {
  rows: Record<string, unknown>[];
  keys: string[];
  /** Rejects a row whose foreign key points at nothing, like Postgres would. */
  fkCheck?: (row: Record<string, unknown>) => boolean;
}

function sameKey(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  keys: string[],
): boolean {
  return keys.every((key) => a[key] === b[key]);
}

/** `warnings` is a Json column; every writer puts a string array in it. */
function warningsOf(job: DataTransferJob): string[] {
  return Array.isArray(job.warnings) ? (job.warnings as string[]) : [];
}

/** Primary keys in these fixtures are always strings, as they are in the schema. */
function keyText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function makeDelegate(table: FakeTable) {
  const sorted = () =>
    [...table.rows].sort(
      (a, b) =>
        table.keys
          .map((key) => keyText(a, key).localeCompare(keyText(b, key)))
          .find((n) => n !== 0) ?? 0,
    );

  const insert = (row: Record<string, unknown>) => {
    if (table.fkCheck && !table.fkCheck(row)) {
      throw new Error('foreign key constraint violated');
    }
    table.rows.push(row);
  };

  return {
    count: () => Promise.resolve(table.rows.length),

    findMany: (args?: {
      take?: number;
      cursor?: Record<string, unknown>;
      skip?: number;
    }) => {
      const all = sorted();
      let start = 0;
      if (args?.cursor) {
        // Prisma addresses composite keys through one nested property.
        const raw = Object.values(args.cursor)[0];
        const cursor = (
          typeof raw === 'object' && raw !== null ? raw : args.cursor
        ) as Record<string, unknown>;
        const index = all.findIndex((row) => sameKey(row, cursor, table.keys));
        start = index < 0 ? 0 : index + (args.skip ?? 0);
      }
      return Promise.resolve(
        all.slice(start, start + (args?.take ?? all.length)),
      );
    },

    createMany: ({
      data,
      skipDuplicates,
    }: {
      data: Record<string, unknown>[];
      skipDuplicates?: boolean;
    }) => {
      const fresh = data.filter(
        (row) => !table.rows.some((held) => sameKey(held, row, table.keys)),
      );
      if (!skipDuplicates && fresh.length !== data.length) {
        throw new Error('unique constraint violated');
      }
      // All-or-nothing, as a single INSERT is.
      for (const row of fresh) {
        if (table.fkCheck && !table.fkCheck(row)) {
          throw new Error('foreign key constraint violated');
        }
      }
      for (const row of fresh) table.rows.push(row);
      return Promise.resolve({ count: fresh.length });
    },

    create: ({ data }: { data: Record<string, unknown> }) => {
      if (table.rows.some((held) => sameKey(held, data, table.keys))) {
        throw new Error('unique constraint violated');
      }
      insert(data);
      return Promise.resolve(data);
    },

    upsert: ({
      where,
      create,
      update,
    }: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const raw = Object.values(where)[0];
      const key = (
        typeof raw === 'object' && raw !== null ? raw : where
      ) as Record<string, unknown>;
      const index = table.rows.findIndex((row) =>
        sameKey(row, key, table.keys),
      );
      if (index >= 0) table.rows[index] = { ...table.rows[index], ...update };
      else insert(create);
      return Promise.resolve(update);
    },
  };
}

/**
 * The chunk table, shared across every fake Prisma in one test so an archive
 * written by an export can be read back by an import — exactly the handoff the
 * real deployment makes through the database.
 */
type ChunkStore = Map<string, Buffer[]>;

function makePrisma(
  tables: Record<string, FakeTable>,
  job: DataTransferJob,
  chunkStore: ChunkStore,
): { prisma: PrismaService; job: DataTransferJob } {
  const delegates: Record<string, unknown> = {};
  for (const [model, table] of Object.entries(tables)) {
    delegates[model] = makeDelegate(table);
  }

  delegates['dataTransferChunk'] = {
    create: ({
      data,
    }: {
      data: { jobId: string; ordinal: number; data: Uint8Array };
    }) => {
      const held = chunkStore.get(data.jobId) ?? [];
      held[data.ordinal] = Buffer.from(data.data);
      chunkStore.set(data.jobId, held);
      return Promise.resolve(data);
    },
    findUnique: ({
      where,
    }: {
      where: { jobId_ordinal: { jobId: string; ordinal: number } };
    }) => {
      const { jobId, ordinal } = where.jobId_ordinal;
      const held = chunkStore.get(jobId)?.[ordinal];
      return Promise.resolve(held ? { data: held, ordinal } : null);
    },
    deleteMany: ({ where }: { where: { jobId: string } }) => {
      chunkStore.delete(where.jobId);
      return Promise.resolve({ count: 0 });
    },
  };

  let current = job;
  delegates['dataTransferJob'] = {
    update: ({ data }: { data: Partial<DataTransferJob> }) => {
      current = { ...current, ...data };
      return Promise.resolve({ cancelRequested: current.cancelRequested });
    },
    findUnique: () => Promise.resolve(current),
  };

  return {
    prisma: delegates as unknown as PrismaService,
    get job() {
      return current;
    },
  };
}

const cls = {
  get: (key: string) => (key.includes('schema') ? 'ns_test' : 'acme'),
} as never;

// The archive is named after the workspace's display name, not its slug.
const registry = {
  get: () => Promise.resolve({ name: 'Acme Investigations' }),
} as never;

const baseJob: DataTransferJob = {
  id: '8f14e45f-ce0a-4e0a-9c6b-2b8d3f7a1c22',
  kind: 'EXPORT',
  status: 'PENDING',
  scopes: [],
  conflictMode: DataTransferConflict.SKIP,
  fileName: null,
  archived: false,
  fileSize: null,
  checksum: null,
  totalRows: 0,
  processedRows: 0,
  skippedRows: 0,
  percent: 0,
  currentTable: null,
  counts: {},
  warnings: [],
  errorMessage: null,
  cancelRequested: false,
  startedAt: null,
  finishedAt: null,
  expiresAt: null,
  createdBy: null,
  createdAt: new Date('2026-07-30T00:00:00.000Z'),
  updatedAt: new Date('2026-07-30T00:00:00.000Z'),
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const encrypted = `${MASKED_CONFIG_ENCRYPTED_PREFIX}abc.def.ghi`;

// Real ids are UUIDs, and the remapper deliberately leaves anything else alone
// (content hashes, enum keys), so the fixtures have to be UUID-shaped or the
// tests would silently exercise the pass-through path instead of the remap.
const SOURCE_ID = '11111111-1111-4111-8111-000000000001';
const RUNNER_ID = '22222222-2222-4222-8222-000000000002';
const assetId = (i: number) =>
  `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`;

/** 1200 assets — enough to force three keyset pages at the 500-row batch size. */
function manyAssets(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: assetId(i),
    sourceId: SOURCE_ID,
    runnerId: RUNNER_ID,
    name: `Doc ${i}`,
  }));
}

function sourceTables() {
  return {
    source: {
      keys: ['id'],
      rows: [
        {
          id: SOURCE_ID,
          name: 'Wiki',
          scheduleEnabled: true,
          currentRunnerId: RUNNER_ID,
          config: {
            base_url: 'https://wiki.example.com',
            masked: { password: encrypted, access_token: encrypted },
          },
        },
      ],
    },
    runner: {
      keys: ['id'],
      rows: [{ id: RUNNER_ID, sourceId: SOURCE_ID }],
    },
    // Composite primary key: exercises the compound cursor and compound upsert
    // paths that the single-key tables never touch.
    runnerAsset: {
      keys: ['runnerId', 'assetHash'],
      rows: [
        { runnerId: RUNNER_ID, assetHash: 'h1', status: 'COMPLETED' },
        { runnerId: RUNNER_ID, assetHash: 'h2', status: 'COMPLETED' },
      ],
    },
    asset: { keys: ['id'], rows: manyAssets(1200) },
  } satisfies Record<string, FakeTable>;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('export → import round trip', () => {
  let chunkStore: ChunkStore;
  let store: ArchiveStoreService;

  beforeEach(() => {
    chunkStore = new Map();
    // The real store, driven by the fake chunk table — so chunking, ordering
    // and reassembly are genuinely exercised rather than stubbed past.
    store = new ArchiveStoreService(makePrisma({}, baseJob, chunkStore).prisma);
  });

  const importer = (prisma: PrismaService) =>
    new NamespaceImportService(prisma, store);

  /** The archive's bytes as one buffer, for assertions about the file itself. */
  const archiveBytes = (jobId: string) =>
    Buffer.concat(chunkStore.get(jobId) ?? []);

  const archiveReader = (jobId: string) =>
    new ArchiveReader(() => Readable.from(chunkStore.get(jobId) ?? []));

  /**
   * Mirror the upload endpoint: an archive is stored against the import job
   * that will read it. Without this the tests would only pass because the
   * export and the import happened to share a job id.
   */
  function stageImport(
    archiveId: string,
    job: DataTransferJob,
  ): DataTransferJob {
    chunkStore.set(job.id, [...(chunkStore.get(archiveId) ?? [])]);
    return job;
  }

  /** Run an export and hand back the finished job row. */
  async function runExport(
    scopes: string[],
    tables: Record<string, FakeTable>,
  ) {
    const job = { ...baseJob, kind: 'EXPORT' as const, scopes };
    const state = makePrisma(tables, job, chunkStore);
    await new NamespaceExportService(state.prisma, store, cls, registry).run(
      job,
    );

    expect(chunkStore.get(job.id)?.length ?? 0).toBeGreaterThan(0);
    return { archiveId: job.id, job: state.job };
  }

  it('walks every row across keyset pages and writes a complete archive', async () => {
    const { archiveId, job } = await runExport(
      ['sources', 'assets', 'scanData'],
      sourceTables(),
    );

    const reader = archiveReader(archiveId);
    const byTable: Record<string, Record<string, unknown>[]> = {};
    for await (const { table, row } of reader.read()) {
      (byTable[table] ??= []).push(row);
    }

    // 1200 assets is well past a single 500-row batch: if the cursor were
    // wrong this would come back short, long, or with duplicates.
    expect(byTable['asset']).toHaveLength(1200);
    expect(new Set(byTable['asset'].map((r) => r['id'])).size).toBe(1200);
    expect(byTable['source']).toHaveLength(1);
    expect(byTable['runner']).toHaveLength(1);

    expect(byTable['runnerAsset']).toHaveLength(2);
    expect(reader.footer?.counts).toEqual({
      source: 1,
      runner: 1,
      asset: 1200,
      runnerAsset: 2,
    });
    expect(job.status).toBe('COMPLETED');
    expect(job.percent).toBe(100);
    // Named for the workspace an operator recognises, not its url slug.
    expect(job.fileName).toMatch(
      /^Acme-Investigations-\d{4}-\d{2}-\d{2}-\d{4}\.cfyre$/,
    );
    expect(Number(job.fileSize)).toBeGreaterThan(0);
    expect(job.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never writes source credentials into the archive', async () => {
    const { archiveId, job } = await runExport(['sources'], sourceTables());

    // The strongest possible assertion: the ciphertext appears nowhere in the
    // compressed bytes.
    const raw = archiveBytes(archiveId);
    expect(raw.includes(Buffer.from(encrypted))).toBe(false);

    const reader = archiveReader(archiveId);
    const rows: Record<string, unknown>[] = [];
    for await (const { row } of reader.read()) rows.push(row);

    const config = rows[0]['config'] as Record<string, unknown>;
    expect(config).not.toHaveProperty('masked');
    expect(config['base_url']).toBe('https://wiki.example.com');
    expect(config['maskedKeys']).toEqual(['password', 'access_token']);

    expect(reader.footer?.stripped).toEqual({ source: ['config.masked'] });
    expect(warningsOf(job).join(' ')).toMatch(/re-entered after import/i);
  });

  it('imports an archive into an empty namespace and disarms the sources', async () => {
    const { archiveId } = await runExport(
      ['sources', 'assets', 'scanData'],
      sourceTables(),
    );

    const target = {
      source: { keys: ['id'], rows: [] },
      runner: { keys: ['id'], rows: [] },
      runnerAsset: { keys: ['runnerId', 'assetHash'], rows: [] },
      asset: {
        keys: ['id'],
        rows: [],
        fkCheck: (row: Record<string, unknown>) =>
          row['runnerId'] === null ||
          target.runner.rows.some((r) => r['id'] === row['runnerId']),
      },
    } as unknown as Record<string, FakeTable>;

    const state = makePrisma(
      target,
      {
        ...baseJob,
        kind: 'IMPORT',
        archived: true,
        scopes: ['sources', 'assets', 'scanData'],
      },
      chunkStore,
    );
    await importer(state.prisma).run(
      stageImport(archiveId, {
        ...baseJob,
        kind: 'IMPORT',
        archived: true,
        scopes: ['sources', 'assets', 'scanData'],
      }),
    );

    expect(target['asset'].rows).toHaveLength(1200);
    expect(target['runner'].rows).toHaveLength(1);
    expect(target['runnerAsset'].rows).toHaveLength(2);
    expect(state.job.status).toBe('COMPLETED');
    expect(state.job.skippedRows).toBe(0);

    // Every row lands under a NEW identity — nothing keeps the id it had in the
    // namespace it came from.
    const source = target['source'].rows[0];
    const runner = target['runner'].rows[0];
    expect(source['id']).not.toBe(SOURCE_ID);
    expect(runner['id']).not.toBe(RUNNER_ID);
    expect(source['id']).toMatch(/^[0-9a-f-]{36}$/);

    // …and every reference was rewritten to match, so the graph is intact.
    expect(runner['sourceId']).toBe(source['id']);
    for (const asset of target['asset'].rows) {
      expect(asset['sourceId']).toBe(source['id']);
      expect(asset['runnerId']).toBe(runner['id']);
      expect(asset['id']).not.toBe(assetId(0));
    }
    // Content hashes are natural keys and must survive untouched, or the
    // runner_assets rows would no longer describe the assets they scanned.
    expect(
      target['runnerAsset'].rows.map((r) => r['assetHash']).sort(),
    ).toEqual(['h1', 'h2']);
    for (const runnerAsset of target['runnerAsset'].rows) {
      expect(runnerAsset['runnerId']).toBe(runner['id']);
    }

    // A source arrives without credentials, so it must not start scanning on a
    // schedule the moment it lands.
    expect(source['scheduleEnabled']).toBe(false);
    expect(source['currentRunnerId']).toBeNull();
    expect(source['runnerStatus']).toBe('PENDING');
  });

  it('never carries a source schedule across instances', async () => {
    const { archiveId } = await runExport(['sources'], sourceTables());

    const reader = archiveReader(archiveId);
    const rows: Record<string, unknown>[] = [];
    for await (const { row } of reader.read()) rows.push(row);

    // Not merely overridden on import — absent from the archive entirely, so a
    // schedule cannot leak to whoever receives the file.
    expect(rows[0]).not.toHaveProperty('scheduleEnabled');
    expect(rows[0]).not.toHaveProperty('scheduleCron');
    expect(rows[0]).not.toHaveProperty('scheduleTimezone');
    expect(rows[0]).not.toHaveProperty('scheduleNextAt');
  });

  it('adds to a namespace that already holds data instead of colliding', async () => {
    const { archiveId } = await runExport(['sources'], sourceTables());

    // The same source id is already present. Before ids were regenerated this
    // was either skipped (losing the import) or overwritten (losing the
    // original); now both survive side by side.
    const target = {
      source: {
        keys: ['id'],
        rows: [{ id: SOURCE_ID, name: 'Existing wiki' }],
      },
    } as unknown as Record<string, FakeTable>;

    const job = stageImport(archiveId, {
      ...baseJob,
      kind: 'IMPORT' as const,
      archived: true,
      scopes: ['sources'],
    });
    const state = makePrisma(target, job, chunkStore);
    await importer(state.prisma).run(job);

    expect(target['source'].rows).toHaveLength(2);
    expect(target['source'].rows.map((r) => r['name']).sort()).toEqual([
      'Existing wiki',
      'Wiki',
    ]);
    expect(state.job.skippedRows).toBe(0);
    expect(state.job.status).toBe('COMPLETED');
  });

  it('reproduces the same ids when the same job is retried', async () => {
    const { archiveId } = await runExport(['sources'], sourceTables());

    const job = stageImport(archiveId, {
      ...baseJob,
      kind: 'IMPORT' as const,
      archived: true,
      scopes: ['sources'],
    });

    const first = { source: { keys: ['id'], rows: [] } } as unknown as Record<
      string,
      FakeTable
    >;
    const second = { source: { keys: ['id'], rows: [] } } as unknown as Record<
      string,
      FakeTable
    >;

    await importer(makePrisma(first, job, chunkStore).prisma).run(job);
    await importer(makePrisma(second, job, chunkStore).prisma).run(job);

    // Retrying an interrupted import must not double the data: the same job id
    // yields the same identities, so the second pass collides and skips.
    expect(first['source'].rows[0]['id']).toBe(second['source'].rows[0]['id']);
  });

  it('gives different imports of one archive independent identities', async () => {
    const { archiveId } = await runExport(['sources'], sourceTables());

    const runImport = async (jobId: string) => {
      const job = stageImport(archiveId, {
        ...baseJob,
        id: jobId,
        kind: 'IMPORT' as const,
        archived: true,
        scopes: ['sources'],
      });
      const target = {
        source: { keys: ['id'], rows: [] },
      } as unknown as Record<string, FakeTable>;
      const state = makePrisma(target, job, chunkStore);
      await importer(state.prisma).run(job);
      return target['source'].rows[0]['id'];
    };

    const a = await runImport('11111111-1111-4111-8111-111111111111');
    const b = await runImport('22222222-2222-4222-8222-222222222222');
    expect(a).not.toBe(b);
  });

  it('clears optional references into a scope the operator left out', async () => {
    const { archiveId } = await runExport(
      ['sources', 'assets', 'scanData'],
      sourceTables(),
    );

    // Assets only. Every asset in the archive carries runnerId 'r1', and no
    // runner is being imported — without the optionalRefs rule the foreign key
    // would reject all 1200.
    const target = {
      source: { keys: ['id'], rows: [] },
      asset: {
        keys: ['id'],
        rows: [],
        fkCheck: (row: Record<string, unknown>) => row['runnerId'] === null,
      },
    } as unknown as Record<string, FakeTable>;

    const state = makePrisma(
      target,
      {
        ...baseJob,
        kind: 'IMPORT',
        archived: true,
        scopes: ['assets'],
      },
      chunkStore,
    );
    await importer(state.prisma).run(
      stageImport(archiveId, {
        ...baseJob,
        kind: 'IMPORT',
        archived: true,
        scopes: ['assets'],
      }),
    );

    expect(target['asset'].rows).toHaveLength(1200);
    expect(target['asset'].rows.every((row) => row['runnerId'] === null)).toBe(
      true,
    );
    expect(target['source'].rows).toHaveLength(0);
    expect(warningsOf(state.job).join(' ')).toMatch(
      /asset\.runnerId.*cleared.*scanData/i,
    );
  });

  it('refuses to import a truncated archive', async () => {
    const { archiveId } = await runExport(['sources'], sourceTables());
    // Drop the tail chunks — the gzip trailer and the footer line with them,
    // which is what a half-finished upload looks like.
    const raw = archiveBytes(archiveId);
    chunkStore.set(archiveId, [raw.subarray(0, Math.floor(raw.length / 2))]);

    const job = stageImport(archiveId, {
      ...baseJob,
      kind: 'IMPORT' as const,
      archived: true,
      scopes: ['sources'],
    });
    const state = makePrisma(
      { source: { keys: ['id'], rows: [] } },
      job,
      chunkStore,
    );

    await expect(importer(state.prisma).run(job)).rejects.toThrow();
  });
});
