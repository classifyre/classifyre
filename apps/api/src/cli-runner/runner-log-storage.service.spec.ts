import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RunnerLogStorageService } from './runner-log-storage.service';

const SOURCE_ID = 'source-test-001';

describe('RunnerLogStorageService', () => {
  it('stores newline-delimited entries and paginates by cursor during an active run', async () => {
    const service = new RunnerLogStorageService();
    const runnerId = 'runner-pagination';

    await service.initializeRunner(SOURCE_ID, runnerId);
    service.appendChunk(runnerId, 'first\nsecond\nthird\n', 'stderr');

    const firstPage = await service.listLogs({
      sourceId: SOURCE_ID,
      runnerId,
      take: 2,
    });
    expect(firstPage.entries.map((entry) => entry.message)).toEqual([
      'first',
      'second',
    ]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await service.listLogs({
      sourceId: SOURCE_ID,
      runnerId,
      cursor: firstPage.nextCursor || undefined,
      take: 2,
    });
    expect(secondPage.entries.map((entry) => entry.message)).toEqual(['third']);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextCursor).toBeNull();

    await service.finalizeRunner(SOURCE_ID, runnerId);
  });

  it('assembles partial stream chunks into complete lines in the in-memory buffer', async () => {
    const service = new RunnerLogStorageService();
    const runnerId = 'runner-partial';

    await service.initializeRunner(SOURCE_ID, runnerId);
    service.appendChunk(runnerId, 'part-1', 'stderr');
    service.appendChunk(runnerId, '-done\nnext-line\n', 'stderr');

    // Both complete lines are readable during the active run
    const logs = await service.listLogs({
      sourceId: SOURCE_ID,
      runnerId,
      take: 20,
    });
    expect(logs.entries.map((entry) => entry.message)).toEqual([
      'part-1-done',
      'next-line',
    ]);

    await service.finalizeRunner(SOURCE_ID, runnerId);
  });

  it('flushes incomplete trailing lines into in-memory buffer on finalizeRunner', async () => {
    const service = new RunnerLogStorageService();
    const runnerId = 'runner-flush';

    await service.initializeRunner(SOURCE_ID, runnerId);
    // 'complete-line\n' is emitted immediately; 'no-newline-yet' stays buffered
    service.appendChunk(runnerId, 'complete-line\nno-newline-yet', 'stderr');

    const beforeFinalize = await service.listLogs({
      sourceId: SOURCE_ID,
      runnerId,
      take: 20,
    });
    // Only the complete line is visible before finalize
    expect(beforeFinalize.entries.map((e) => e.message)).toEqual([
      'complete-line',
    ]);

    // finalizeRunner should not throw even with an unterminated trailing line
    await service.finalizeRunner(SOURCE_ID, runnerId);
  });

  it('treats unrecognised cursors as offset 0 during an active run', async () => {
    const service = new RunnerLogStorageService();
    const runnerId = 'runner-invalid-cursor';

    await service.initializeRunner(SOURCE_ID, runnerId);
    service.appendChunk(runnerId, 'line\n', 'stderr');

    // An unrecognised cursor (neither a byte-offset number nor 'i:N') is
    // treated as offset 0, so the full log is returned rather than throwing.
    const result = await service.listLogs({
      sourceId: SOURCE_ID,
      runnerId,
      cursor: 'abc',
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].message).toBe('line');

    await service.finalizeRunner(SOURCE_ID, runnerId);
  });

  it('returns empty entries after finalizeRunner when S3 is not configured', async () => {
    const service = new RunnerLogStorageService();
    const runnerId = 'runner-ephemeral';

    await service.initializeRunner(SOURCE_ID, runnerId);
    service.appendChunk(runnerId, 'line-1\n', 'stderr');
    await service.finalizeRunner(SOURCE_ID, runnerId);

    // Without S3, logs are ephemeral — cleared from memory on finalize
    const logs = await service.listLogs({
      sourceId: SOURCE_ID,
      runnerId,
      take: 20,
    });
    expect(logs.entries).toHaveLength(0);
    expect(logs.hasMore).toBe(false);
  });

  it('clears in-memory state on deleteRunnerLogs', async () => {
    const service = new RunnerLogStorageService();
    const runnerId = 'runner-delete';

    await service.initializeRunner(SOURCE_ID, runnerId);
    service.appendChunk(runnerId, 'line-1\n', 'stderr');
    await service.deleteRunnerLogs(SOURCE_ID, runnerId);

    const logs = await service.listLogs({
      sourceId: SOURCE_ID,
      runnerId,
      take: 20,
    });
    expect(logs.entries).toHaveLength(0);
    expect(logs.hasMore).toBe(false);
  });
});

describe('RunnerLogStorageService (local filesystem backend)', () => {
  const ENV_KEYS = [
    'RUNNER_LOG_DIR',
    'RUNNER_LOG_MAX_LINES_PER_RUN',
    'RUNNER_LOG_MAX_MB_PER_RUN',
    'RUNNER_LOG_MAX_TOTAL_MB',
    'S3_BUCKET',
  ] as const;
  let savedEnv: Record<string, string | undefined>;
  let tmpDir: string;

  beforeEach(async () => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const key of ENV_KEYS) delete process.env[key];
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'runner-logs-test-'));
    process.env.RUNNER_LOG_DIR = tmpDir;
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  async function createService(): Promise<RunnerLogStorageService> {
    const service = new RunnerLogStorageService();
    await service.onModuleInit();
    return service;
  }

  it('persists logs to disk and serves them after finalizeRunner', async () => {
    const service = await createService();
    const runnerId = 'runner-local-persist';

    await service.initializeRunner(SOURCE_ID, runnerId);
    service.appendChunk(runnerId, 'alpha\nbeta\n', 'stderr');
    await service.finalizeRunner(SOURCE_ID, runnerId);

    const logs = await service.listLogs({
      sourceId: SOURCE_ID,
      runnerId,
      take: 20,
    });
    expect(logs.entries.map((e) => e.message)).toEqual(['alpha', 'beta']);

    // A brand-new service instance (fresh process) reads the same files.
    const reopened = await createService();
    const reread = await reopened.listLogs({
      sourceId: SOURCE_ID,
      runnerId,
      take: 20,
    });
    expect(reread.entries.map((e) => e.message)).toEqual(['alpha', 'beta']);

    await service.onModuleDestroy();
    await reopened.onModuleDestroy();
  });

  it('deletes the stored file on deleteRunnerLogs', async () => {
    const service = await createService();
    const runnerId = 'runner-local-delete';

    await service.initializeRunner(SOURCE_ID, runnerId);
    service.appendChunk(runnerId, 'line\n', 'stderr');
    await service.finalizeRunner(SOURCE_ID, runnerId);
    await service.deleteRunnerLogs(SOURCE_ID, runnerId);

    const logs = await service.listLogs({
      sourceId: SOURCE_ID,
      runnerId,
      take: 20,
    });
    expect(logs.entries).toHaveLength(0);
    expect(await service.listStoredLogObjects()).toHaveLength(0);

    await service.onModuleDestroy();
  });

  it('drops earliest lines and reports truncation once the per-run line cap is hit', async () => {
    process.env.RUNNER_LOG_MAX_LINES_PER_RUN = '5';
    const service = await createService();
    const runnerId = 'runner-local-cap';

    await service.initializeRunner(SOURCE_ID, runnerId);
    const lines = Array.from({ length: 12 }, (_, i) => `line-${i}`);
    service.appendChunk(runnerId, `${lines.join('\n')}\n`, 'stderr');
    await service.finalizeRunner(SOURCE_ID, runnerId);

    const logs = await service.listLogs({
      sourceId: SOURCE_ID,
      runnerId,
      take: 20,
    });
    // Truncation notice + the 5 most recent lines
    expect(logs.entries[0].message).toContain('[log truncated]');
    expect(logs.entries.slice(1).map((e) => e.message)).toEqual([
      'line-7',
      'line-8',
      'line-9',
      'line-10',
      'line-11',
    ]);

    await service.onModuleDestroy();
  });

  it('lists stored log objects for the cleanup sweep', async () => {
    const service = await createService();
    const runnerId = 'runner-local-list';

    await service.initializeRunner(SOURCE_ID, runnerId);
    service.appendChunk(runnerId, 'line\n', 'stderr');
    await service.finalizeRunner(SOURCE_ID, runnerId);

    const objects = await service.listStoredLogObjects();
    expect(objects).toHaveLength(1);
    expect(objects[0].sourceId).toBe(SOURCE_ID);
    expect(objects[0].runnerId).toBe(runnerId);
    expect(objects[0].size).toBeGreaterThan(0);

    await service.onModuleDestroy();
  });

  it('prunes oldest completed-run files to stay under the total storage cap', async () => {
    process.env.RUNNER_LOG_MAX_TOTAL_MB = '1';
    const service = await createService();

    // Two runs of ~0.7MB each: after the second finalize the first file
    // must be pruned to keep the directory under the 1MB cap.
    const bigChunk = `${'x'.repeat(1024)}\n`.repeat(700);

    await service.initializeRunner(SOURCE_ID, 'runner-old');
    service.appendChunk('runner-old', bigChunk, 'stderr');
    await service.finalizeRunner(SOURCE_ID, 'runner-old');

    // Ensure distinct mtimes so pruning order is deterministic.
    await new Promise((resolve) => setTimeout(resolve, 20));

    await service.initializeRunner(SOURCE_ID, 'runner-new');
    service.appendChunk('runner-new', bigChunk, 'stderr');
    await service.finalizeRunner(SOURCE_ID, 'runner-new');

    // Cap enforcement runs fire-and-forget after finalize; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const objects = await service.listStoredLogObjects();
    expect(objects.map((o) => o.runnerId)).toEqual(['runner-new']);

    await service.onModuleDestroy();
  });
});
