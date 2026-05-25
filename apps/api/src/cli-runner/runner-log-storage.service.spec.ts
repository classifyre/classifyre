import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { RunnerLogStorageService } from './runner-log-storage.service';

const SOURCE_ID = 'source-test-001';

describe('RunnerLogStorageService', () => {
  const originalLogsDir = process.env.RUNNER_LOGS_DIR;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-logs-test-'));
    process.env.RUNNER_LOGS_DIR = tempDir;
  });

  afterEach(async () => {
    process.env.RUNNER_LOGS_DIR = originalLogsDir;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('stores newline-delimited entries and paginates by cursor', async () => {
    const service = new RunnerLogStorageService();
    const runnerId = 'runner-pagination';

    await service.initializeRunner(SOURCE_ID, runnerId);
    service.appendChunk(runnerId, 'first\nsecond\nthird\n', 'stderr');
    await service.finalizeRunner(SOURCE_ID, runnerId);

    const firstPage = await service.listLogs({ sourceId: SOURCE_ID, runnerId, take: 2 });
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
  });

  it('flushes partial stream chunks on finalize', async () => {
    const service = new RunnerLogStorageService();
    const runnerId = 'runner-partial';

    await service.initializeRunner(SOURCE_ID, runnerId);
    service.appendChunk(runnerId, 'part-1', 'stderr');
    service.appendChunk(runnerId, '-done\nnext-line\n', 'stderr');
    await service.finalizeRunner(SOURCE_ID, runnerId);

    const logs = await service.listLogs({ sourceId: SOURCE_ID, runnerId, take: 20 });
    expect(logs.entries.map((entry) => entry.message)).toEqual([
      'part-1-done',
      'next-line',
    ]);
  });

  it('treats unrecognised cursors as start-of-file', async () => {
    const service = new RunnerLogStorageService();
    const runnerId = 'runner-invalid-cursor';
    await service.initializeRunner(SOURCE_ID, runnerId);
    service.appendChunk(runnerId, 'line\n', 'stderr');
    await service.finalizeRunner(SOURCE_ID, runnerId);

    // An unrecognised cursor (neither a byte-offset number nor 'i:N') is
    // treated as offset 0, so the full log is returned rather than throwing.
    const result = await service.listLogs({ sourceId: SOURCE_ID, runnerId, cursor: 'abc' });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].message).toBe('line');
  });

  it('removes runner log directory when deleteRunnerLogs is called', async () => {
    const service = new RunnerLogStorageService();
    const runnerId = 'runner-delete';

    await service.initializeRunner(SOURCE_ID, runnerId);
    service.appendChunk(runnerId, 'line-1\n', 'stderr');
    await service.finalizeRunner(SOURCE_ID, runnerId);
    await service.deleteRunnerLogs(SOURCE_ID, runnerId);

    const logs = await service.listLogs({ sourceId: SOURCE_ID, runnerId, take: 20 });
    expect(logs.entries).toHaveLength(0);
    expect(logs.hasMore).toBe(false);
  });
});
