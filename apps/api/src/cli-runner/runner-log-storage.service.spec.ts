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
