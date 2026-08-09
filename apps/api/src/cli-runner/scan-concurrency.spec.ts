import { CliRunnerService } from './cli-runner.service';
import type { PrismaService } from '../prisma.service';

/**
 * How many scans a workspace may run at once.
 *
 * This was a process-wide environment variable that the desktop app pinned to
 * 1 — one number for every workspace on the machine, unreachable from the UI.
 * A workspace with 151 sources at ~12 minutes a scan needs about 29 hours for a
 * single sweep at that setting, and the harness spends the whole time reasoning
 * about 5% of a corpus.
 *
 * It is now per-workspace (instance_settings lives in the namespace schema),
 * with the environment variable kept as a deployment-wide override: a shared
 * box's limits are not a tenant's to raise.
 */
describe('scan concurrency', () => {
  const ENV = process.env.MAX_CONCURRENT_RUNNERS;
  let findUnique: jest.Mock;
  let count: jest.Mock;
  let service: CliRunnerService;

  const build = (configured: number | null | undefined) => {
    findUnique = jest
      .fn()
      .mockResolvedValue(
        configured === undefined ? null : { maxConcurrentRunners: configured },
      );
    count = jest.fn().mockResolvedValue(0);
    service = Object.create(CliRunnerService.prototype) as CliRunnerService;
    Object.assign(service, {
      prisma: {
        instanceSettings: { findUnique },
        runner: { count },
      } as unknown as PrismaService,
      logger: { warn: jest.fn(), log: jest.fn() },
    });
  };

  const limit = () =>
    (
      service as unknown as {
        resolveMaxConcurrentRunners: () => Promise<number>;
      }
    ).resolveMaxConcurrentRunners();

  const canStart = () =>
    (
      service as unknown as { canStartNewRunner: () => Promise<boolean> }
    ).canStartNewRunner();

  beforeEach(() => {
    delete process.env.MAX_CONCURRENT_RUNNERS;
  });
  afterEach(() => {
    if (ENV === undefined) delete process.env.MAX_CONCURRENT_RUNNERS;
    else process.env.MAX_CONCURRENT_RUNNERS = ENV;
  });

  it('uses the workspace setting', async () => {
    build(4);
    await expect(limit()).resolves.toBe(4);
  });

  it('defaults to 2 when the workspace has no settings row yet', async () => {
    build(undefined);
    await expect(limit()).resolves.toBe(2);
  });

  it('honours 0 as unlimited rather than falling back', async () => {
    build(0);
    await expect(limit()).resolves.toBe(0);
    // 0 must short-circuit before counting anything.
    await expect(canStart()).resolves.toBe(true);
    expect(count).not.toHaveBeenCalled();
  });

  // A shared machine's ceiling is not a tenant's to raise.
  it('lets a deployment-wide override win over the workspace setting', async () => {
    process.env.MAX_CONCURRENT_RUNNERS = '1';
    build(8);
    await expect(limit()).resolves.toBe(1);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('ignores a malformed override and falls back to the workspace', async () => {
    process.env.MAX_CONCURRENT_RUNNERS = 'not-a-number';
    build(3);
    await expect(limit()).resolves.toBe(3);
  });

  // Never let a settings read stop a scan: the default is strictly better
  // than refusing to run.
  it('falls back to the default when settings cannot be read', async () => {
    build(2);
    findUnique.mockRejectedValue(new Error('db down'));
    await expect(limit()).resolves.toBe(2);
  });

  describe('canStartNewRunner', () => {
    it('admits a run below the limit and refuses at it', async () => {
      build(2);
      count.mockResolvedValue(1);
      await expect(canStart()).resolves.toBe(true);

      count.mockResolvedValue(2);
      await expect(canStart()).resolves.toBe(false);
    });
  });
});
