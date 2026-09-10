import { CliRunnerService } from './cli-runner.service';
import { RunnerExecutionMode, RunnerStatus } from '@prisma/client';
import type { PrismaService } from '../prisma.service';

/**
 * Which in-flight runners the reaper is allowed to fail.
 *
 * The regression this guards made the concurrency queue unusable. Both callers
 * reconcile exactly when runners are queued — auto-schedule only when
 * `budget <= 0`, and startRun before admitting another — and the sweep selected
 * PENDING alongside RUNNING. A PENDING runner has a null jobName by definition,
 * `isRunnerExecutionActive` reads a null jobName as "gone", so every correctly
 * queued run was failed with "Runner was orphaned (its execution no longer
 * exists)" within a minute of being triggered. Seen in classifyre-dev as five
 * such rows, each with a null job_name and a null started_at: none of them had
 * ever run, and lowering MAX_CONCURRENT_RUNNERS to 1 made it constant.
 */
describe('orphan reconciliation', () => {
  let service: CliRunnerService;
  let findMany: jest.Mock;
  let isJobActive: jest.Mock;
  let markOrphaned: jest.Mock;
  let activeExecutions: Map<string, unknown>;

  const build = () => {
    findMany = jest.fn().mockResolvedValue([]);
    isJobActive = jest.fn().mockResolvedValue(true);
    markOrphaned = jest.fn().mockResolvedValue(undefined);
    activeExecutions = new Map();
    service = Object.create(CliRunnerService.prototype) as CliRunnerService;
    Object.assign(service, {
      prisma: {
        runner: { findMany },
        source: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService,
      kubernetesCliJobService: {
        isEnabled: () => true,
        isJobActive,
      },
      logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() },
      markRunnerAsOrphaned: markOrphaned,
      activeExecutions,
      reconcileRunningSources: jest.fn().mockResolvedValue(0),
    });
  };

  const reconcile = () =>
    (
      service as unknown as { reconcileStaleInFlight: () => Promise<number> }
    ).reconcileStaleInFlight();

  const runner = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    sourceId: 's1',
    status: RunnerStatus.RUNNING,
    executionMode: RunnerExecutionMode.KUBERNETES,
    jobName: 'classifyre-extract-abc',
    jobNamespace: 'classifyre-dev',
    triggeredAt: new Date(Date.now() - 60 * 60 * 1000),
    startedAt: new Date(Date.now() - 60 * 60 * 1000),
    ...over,
  });

  beforeEach(build);

  it('never asks the database for PENDING runners', async () => {
    await reconcile();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: RunnerStatus.RUNNING } }),
    );
  });

  it('retires a RUNNING runner whose Job is gone', async () => {
    findMany.mockResolvedValue([runner()]);
    isJobActive.mockResolvedValue(false);

    await expect(reconcile()).resolves.toBe(1);
    expect(markOrphaned).toHaveBeenCalledWith(
      'r1',
      's1',
      'Runner was orphaned (its execution no longer exists)',
    );
  });

  it('leaves a RUNNING runner alone while its Job is alive', async () => {
    findMany.mockResolvedValue([runner()]);
    isJobActive.mockResolvedValue(true);

    await expect(reconcile()).resolves.toBe(0);
    expect(markOrphaned).not.toHaveBeenCalled();
  });

  it('spares a runner still inside the launch window', async () => {
    // RUNNING is set before the Job exists, so "no jobName" here means "still
    // starting", not "vanished".
    findMany.mockResolvedValue([
      runner({ jobName: null, startedAt: null, triggeredAt: new Date() }),
    ]);

    await expect(reconcile()).resolves.toBe(0);
    expect(markOrphaned).not.toHaveBeenCalled();
  });

  it('retires a runner that never launched once the window passes', async () => {
    findMany.mockResolvedValue([
      runner({
        jobName: null,
        startedAt: null,
        triggeredAt: new Date(Date.now() - 10 * 60 * 1000),
      }),
    ]);

    await expect(reconcile()).resolves.toBe(1);
    expect(markOrphaned).toHaveBeenCalledWith(
      'r1',
      's1',
      'Runner was orphaned (it never started an execution)',
    );
  });

  it('assumes a runner is alive when the Kubernetes API itself fails', async () => {
    // "Not found" is already a clean false inside isJobActive, so an exception
    // means the question failed, not that the Job is gone. Failing the scan on
    // a control-plane blip is the destructive answer.
    findMany.mockResolvedValue([runner()]);
    isJobActive.mockRejectedValue(new Error('etcdserver: request timed out'));

    await expect(reconcile()).resolves.toBe(0);
    expect(markOrphaned).not.toHaveBeenCalled();
  });

  describe('LOCAL runners', () => {
    // A local scan has no Job to ask about: the process that launched it is the
    // only thing that can vouch for it. Answering "gone" unconditionally read
    // every healthy local scan as dead once it outlived the launch grace, and
    // startRun reconciles first -- so in the all-in-one image and the desktop
    // app, the next scan anyone started failed the one already running.
    const local = (over: Record<string, unknown> = {}) =>
      runner({
        executionMode: RunnerExecutionMode.LOCAL,
        jobName: null,
        jobNamespace: null,
        ...over,
      });

    it('leaves a long-running local scan alone while this process runs it', async () => {
      findMany.mockResolvedValue([local()]);
      activeExecutions.set('r1', {});

      await expect(reconcile()).resolves.toBe(0);
      expect(markOrphaned).not.toHaveBeenCalled();
    });

    it('retires a local runner no process is executing', async () => {
      findMany.mockResolvedValue([local()]);

      await expect(reconcile()).resolves.toBe(1);
      expect(markOrphaned).toHaveBeenCalledWith(
        'r1',
        's1',
        'Runner was orphaned (its execution no longer exists)',
      );
    });

    it('says a local runner never started only when it never did', async () => {
      // A local run never carries a Job name, so keying this on jobName called
      // every lost local scan "never started", however long it had run.
      findMany.mockResolvedValue([
        local({
          startedAt: null,
          triggeredAt: new Date(Date.now() - 10 * 60 * 1000),
        }),
      ]);

      await expect(reconcile()).resolves.toBe(1);
      expect(markOrphaned).toHaveBeenCalledWith(
        'r1',
        's1',
        'Runner was orphaned (it never started an execution)',
      );
    });
  });
});
