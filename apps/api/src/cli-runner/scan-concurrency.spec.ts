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
 *
 * "Belongs to the machine" was the intent but not the behaviour: the count ran
 * through the schema-scoped Prisma proxy, so the cap applied per workspace and a
 * four-workspace deployment configured for 2 could run 8 scans at once. The
 * count now spans every active tenant schema, which is the shape of the
 * contention it is trying to bound.
 */
describe('scan concurrency', () => {
  const ENV = process.env.MAX_CONCURRENT_RUNNERS;
  let count: jest.Mock;
  let service: CliRunnerService;

  let countAcross: jest.Mock;

  const build = (withRegistry = false) => {
    count = jest.fn().mockResolvedValue(0);
    countAcross = jest.fn().mockResolvedValue(0);
    service = Object.create(CliRunnerService.prototype) as CliRunnerService;
    Object.assign(service, {
      prisma: { runner: { count } } as unknown as PrismaService,
      logger: { warn: jest.fn(), log: jest.fn() },
      namespaceRegistry: withRegistry
        ? { countRowsAcrossNamespaces: countAcross }
        : undefined,
    });
  };

  const limit = () =>
    (
      service as unknown as {
        resolveMaxConcurrentRunners: () => number;
      }
    ).resolveMaxConcurrentRunners();

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

  it('holds a workspace below the deployment ceiling when its limit is reached', async () => {
    process.env.MAX_CONCURRENT_RUNNERS = '4';
    count.mockResolvedValue(1);
    Object.assign(service, {
      deploymentSettings: { override: jest.fn().mockResolvedValue(1) },
    });
    await expect(canStart()).resolves.toBe(false);
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

    it('falls back to the scoped count with no registry (desktop)', async () => {
      process.env.MAX_CONCURRENT_RUNNERS = '2';
      count.mockResolvedValue(2);
      await expect(canStart()).resolves.toBe(false);
      expect(count).toHaveBeenCalled();
    });
  });

  describe('deployment-wide counting', () => {
    beforeEach(() => build(true));

    it('counts RUNNING rows across every tenant, not just the caller', async () => {
      process.env.MAX_CONCURRENT_RUNNERS = '2';
      countAcross.mockResolvedValue(2);

      await expect(canStart()).resolves.toBe(false);
      expect(countAcross).toHaveBeenCalledWith('runners', "status = 'RUNNING'");
      // The regression this guards: one scan in each of two workspaces read as
      // "1 running" through the scoped client and admitted a third.
      expect(count).not.toHaveBeenCalled();
    });

    it('admits while the deployment-wide total is under the limit', async () => {
      process.env.MAX_CONCURRENT_RUNNERS = '2';
      countAcross.mockResolvedValue(1);
      await expect(canStart()).resolves.toBe(true);
    });

    it('holds new runners when the cross-namespace count fails', async () => {
      process.env.MAX_CONCURRENT_RUNNERS = '2';
      countAcross.mockRejectedValue(new Error('registry unreachable'));

      // Refusing is the safe answer: falling back to the scoped count would
      // under-report and exceed the cap exactly when the database is already
      // in trouble.
      await expect(canStart()).resolves.toBe(false);
      expect(count).not.toHaveBeenCalled();
    });

    it('still treats 0 as unlimited without querying', async () => {
      process.env.MAX_CONCURRENT_RUNNERS = '0';
      await expect(canStart()).resolves.toBe(true);
      expect(countAcross).not.toHaveBeenCalled();
    });
  });

  describe('workspace limit (Settings)', () => {
    let override: jest.Mock;

    beforeEach(() => {
      build(true);
      process.env.MAX_CONCURRENT_RUNNERS = '4';
      override = jest.fn().mockResolvedValue(null);
      Object.assign(service, { deploymentSettings: { override } });
    });

    it('holds a workspace at its own cap even though the machine has room', async () => {
      override.mockResolvedValue(1);
      count.mockResolvedValue(1);
      countAcross.mockResolvedValue(1);

      await expect(canStart()).resolves.toBe(false);
      // Decided from the workspace's own rows; the machine-wide count is moot.
      expect(countAcross).not.toHaveBeenCalled();
    });

    it('still enforces the installation-wide ceiling under a roomy workspace cap', async () => {
      override.mockResolvedValue(10);
      count.mockResolvedValue(0);
      countAcross.mockResolvedValue(4);

      await expect(canStart()).resolves.toBe(false);
    });

    it('admits when both the workspace cap and the ceiling have room', async () => {
      override.mockResolvedValue(2);
      count.mockResolvedValue(1);
      countAcross.mockResolvedValue(3);

      await expect(canStart()).resolves.toBe(true);
    });

    it('treats an empty or 0 workspace cap as no workspace cap', async () => {
      for (const value of [null, 0]) {
        override.mockResolvedValue(value);
        countAcross.mockResolvedValue(1);
        await expect(canStart()).resolves.toBe(true);
      }
      expect(count).not.toHaveBeenCalled();
    });

    it("does not let the caller's own cap stop the cross-namespace dequeue", async () => {
      // The caller's workspace is full, but the next run belongs elsewhere:
      // only the instance-wide ceiling is the caller's to decide.
      override.mockResolvedValue(1);
      count.mockResolvedValue(1);
      countAcross.mockResolvedValue(1);
      const findNextPendingRunner = jest.fn().mockResolvedValue(null);
      Object.assign(service, {
        cls: { get: jest.fn(), run: jest.fn() },
        namespaceRegistry: {
          countRowsAcrossNamespaces: countAcross,
          findNextPendingRunner,
        },
      });

      await (
        service as unknown as {
          dequeueNextPendingRunner: () => Promise<boolean>;
        }
      ).dequeueNextPendingRunner();

      expect(findNextPendingRunner).toHaveBeenCalledTimes(1);
      expect(count).not.toHaveBeenCalled();
    });

    it('does not dequeue at all once the ceiling is reached', async () => {
      countAcross.mockResolvedValue(4);
      const findNextPendingRunner = jest.fn();
      Object.assign(service, {
        cls: { get: jest.fn(), run: jest.fn() },
        namespaceRegistry: {
          countRowsAcrossNamespaces: countAcross,
          findNextPendingRunner,
        },
      });

      await expect(
        (
          service as unknown as {
            dequeueNextPendingRunner: () => Promise<boolean>;
          }
        ).dequeueNextPendingRunner(),
      ).resolves.toBe(false);
      expect(findNextPendingRunner).not.toHaveBeenCalled();
    });
  });
});
