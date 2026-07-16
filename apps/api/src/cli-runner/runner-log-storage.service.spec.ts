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

// G-031. Level was inferred by scanning the whole message for the first level
// word, then defaulting anything on stderr to ERROR. Python logs every level
// to stderr and libraries print progress there, so real failures were buried
// under model-download chatter and OpenCV notices — the ERROR count could not
// be trusted, by an operator or by automation.
describe('RunnerLogStorageService level inference (G-031)', () => {
  const levelOf = (message: string, stream: 'stdout' | 'stderr' = 'stderr') =>
    (new RunnerLogStorageService() as any).inferLevel(stream, message);

  describe('levels a logger actually emitted', () => {
    // The CLI's own format: main.py basicConfig "%(levelname)s:%(name)s: %(message)s".
    it('reads the CLI logger prefix', () => {
      expect(
        levelOf('INFO:src.pipeline.detector_pipeline: Scanning a.pdf'),
      ).toBe('INFO');
      expect(levelOf('ERROR:src.detectors.pii.detector: analyzer failed')).toBe(
        'ERROR',
      );
      expect(levelOf('WARNING:src.utils.file_parser: empty OCR result')).toBe(
        'WARN',
      );
    });

    it('reads the worker-pool prefix', () => {
      expect(levelOf('INFO:src.pipeline:[worker-123] Scanning b.pdf')).toBe(
        'INFO',
      );
    });

    it('reads bracketed and dashed prefixes', () => {
      expect(levelOf('[ERROR] something broke')).toBe('ERROR');
      expect(levelOf('WARN - deprecated flag')).toBe('WARN');
      expect(levelOf('CRITICAL: disk full')).toBe('FATAL');
    });

    it('reads a timestamped format', () => {
      expect(
        levelOf('2026-07-15 10:00:00,123 - src.pipeline - INFO - Scanning'),
      ).toBe('INFO');
      expect(
        levelOf('2026-07-15 10:00:00,123 - src.pipeline - ERROR - boom'),
      ).toBe('ERROR');
    });

    it('reads structured JSON', () => {
      expect(levelOf('{"level":"warning","message":"slow"}')).toBe('WARN');
    });

    it('is case insensitive', () => {
      expect(levelOf('info:src.pipeline: hello')).toBe('INFO');
    });
  });

  describe('prose that merely mentions a level', () => {
    it('does not read a level out of the message body', () => {
      expect(levelOf('Scan completed with no error found')).toBe('UNKNOWN');
      expect(levelOf('Loading model from /opt/models/debug/weights.bin')).toBe(
        'UNKNOWN',
      );
      expect(levelOf('Retrying after error handling routine finished')).toBe(
        'UNKNOWN',
      );
    });

    it('does not let a mid-message level override the real one', () => {
      // Previously the first level word anywhere won, so this became INFO.
      expect(levelOf('ERROR:src.detectors: info about the failure')).toBe(
        'ERROR',
      );
    });
  });

  describe('third-party stderr chatter is not an error', () => {
    // These are the lines the corpus run recorded as ERROR.
    it('does not mark model-load progress as ERROR', () => {
      expect(
        levelOf('Downloading model.safetensors:  42%|████      | 180M/430M'),
      ).toBe('UNKNOWN');
    });

    it('does not mark a transformer compatibility notice as ERROR', () => {
      expect(
        levelOf(
          'Some weights of the model checkpoint were not used when initializing',
        ),
      ).toBe('UNKNOWN');
    });

    it('does not mark an OpenCV/AV duplicate-class warning as ERROR', () => {
      expect(
        levelOf(
          'objc[1234]: Class AVFFrameReceiver is implemented in both libavdevice',
        ),
      ).toBe('UNKNOWN');
    });

    it('treats plain stdout and stderr chatter identically', () => {
      const message = 'some library output with no level';
      expect(levelOf(message, 'stderr')).toBe(levelOf(message, 'stdout'));
    });
  });

  describe('genuine failures still surface', () => {
    it('marks a Python traceback as ERROR even without a level token', () => {
      const traceback = [
        'Traceback (most recent call last):',
        '  File "/app/src/main.py", line 42, in <module>',
        "TypeError: unsupported operand type(s) for -: 'ChunkSize' and 'ChunkOverlap'",
      ].join('\n');

      expect(levelOf(traceback)).toBe('ERROR');
    });
  });
});
