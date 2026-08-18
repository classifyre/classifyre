import { CliRunnerService } from './cli-runner.service';
import type { PrismaService } from '../prisma.service';

/**
 * How many scans this machine may run at once.
 *
 * Briefly a per-workspace setting in instance_settings, which turned out to be
 * the wrong shape: two scans contend for the same cores whichever workspace
 * started them, and every real deployment set MAX_CONCURRENT_RUNNERS (the Helm
 * chart always does), which won over the row — so the in-app dial was inert
 * wherever anyone could see it. The budget now belongs to whoever owns the
 * machine: the chart on Kubernetes, the settings window on desktop.
 */
describe('scan concurrency', () => {
  const ENV = process.env.MAX_CONCURRENT_RUNNERS;
  let count: jest.Mock;
  let service: CliRunnerService;

  const build = () => {
    count = jest.fn().mockResolvedValue(0);
    service = Object.create(CliRunnerService.prototype) as CliRunnerService;
    Object.assign(service, {
      prisma: { runner: { count } } as unknown as PrismaService,
      logger: { warn: jest.fn(), log: jest.fn() },
    });
  };

  const limit = () =>
    (service as unknown as { resolveMaxConcurrentRunners: () => number })
      .resolveMaxConcurrentRunners();

  const canStart = () =>
    (
      service as unknown as { canStartNewRunner: () => Promise<boolean> }
    ).canStartNewRunner();

  beforeEach(() => {
    delete process.env.MAX_CONCURRENT_RUNNERS;
    build();
  });
  afterEach(() => {
    if (ENV === undefined) delete process.env.MAX_CONCURRENT_RUNNERS;
    else process.env.MAX_CONCURRENT_RUNNERS = ENV;
  });

  it('uses the configured limit', () => {
    process.env.MAX_CONCURRENT_RUNNERS = '4';
    expect(limit()).toBe(4);
  });

  it('defaults to 2 when nothing is configured', () => {
    expect(limit()).toBe(2);
  });

  it('honours 0 as unlimited rather than falling back', async () => {
    process.env.MAX_CONCURRENT_RUNNERS = '0';
    expect(limit()).toBe(0);
    // 0 must short-circuit before counting anything.
    await expect(canStart()).resolves.toBe(true);
    expect(count).not.toHaveBeenCalled();
  });

  it('ignores a malformed value and falls back to the default', () => {
    process.env.MAX_CONCURRENT_RUNNERS = 'not-a-number';
    expect(limit()).toBe(2);
  });

  it('ignores a negative value and falls back to the default', () => {
    process.env.MAX_CONCURRENT_RUNNERS = '-1';
    expect(limit()).toBe(2);
  });

  it('ignores an empty value and falls back to the default', () => {
    process.env.MAX_CONCURRENT_RUNNERS = '   ';
    expect(limit()).toBe(2);
  });

  describe('canStartNewRunner', () => {
    it('admits a run below the limit and refuses at it', async () => {
      process.env.MAX_CONCURRENT_RUNNERS = '2';
      count.mockResolvedValue(1);
      await expect(canStart()).resolves.toBe(true);

      count.mockResolvedValue(2);
      await expect(canStart()).resolves.toBe(false);
    });
  });
});
