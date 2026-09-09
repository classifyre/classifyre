import { RunnerStatus } from '@prisma/client';
import { RunnerCleanupService } from './runner-cleanup.service';

/**
 * A runner row and its Kubernetes Job can drift apart, and the drift is not
 * symmetric: the API marks a runner ERROR the instant a CLI call fails, but
 * nothing makes the pod exit, and K8S_CLI_JOB_CLEANUP_POLICY=failed only reaps
 * a Job once the POD fails — which never happens while the process runs on.
 *
 * Measured on a dev cluster: three runners marked ERROR within one second of
 * starting (a permanent 503 from the ingestion backpressure guard), their
 * extract pods still Running forty minutes later, one holding 1.9 CPU and
 * 2.3 GB on a node that was OOM-killing the worker.
 *
 * The reason this matters beyond wasted capacity is that orphans are invisible
 * to the concurrency cap. `canStartNewRunner` counts runner ROWS in RUNNING, so
 * a pod whose row says ERROR burns the node without occupying a slot, and
 * MAX_CONCURRENT_RUNNERS stops being a real limit.
 */
describe('orphaned CLI Job reaper', () => {
  function harness(
    rows: Array<Record<string, unknown>>,
    opts: { active?: (n: string) => boolean } = {},
  ) {
    const stopped: string[] = [];
    let where: Record<string, any> = {};

    const prisma = {
      runner: {
        findMany: jest.fn((args: { where: Record<string, any> }) => {
          where = args.where;
          return Promise.resolve(rows);
        }),
      },
    };
    const k8sJobs = {
      isJobActive: jest.fn((name: string) =>
        Promise.resolve(opts.active ? opts.active(name) : true),
      ),
      stopRunnerJob: jest.fn((id: string) => {
        stopped.push(id);
        return Promise.resolve();
      }),
    };

    const service = new RunnerCleanupService(
      prisma as never,
      {} as never,
      {} as never,
      k8sJobs as never,
    );
    return { service, prisma, k8sJobs, stopped, getWhere: () => where };
  }

  const terminal = (over: Record<string, unknown> = {}) => ({
    id: 'runner-1',
    status: RunnerStatus.ERROR,
    jobName: 'classifyre-extract-abc',
    jobNamespace: 'classifyre-dev',
    completedAt: new Date('2026-09-08T11:53:08Z'),
    ...over,
  });

  it('deletes the Job of a terminal runner whose pod is still alive', async () => {
    const h = harness([terminal()]);

    const result = await h.service.reapOrphanedJobs();

    expect(result.reaped).toBe(1);
    expect(h.stopped).toEqual(['runner-1']);
    expect(h.k8sJobs.stopRunnerJob).toHaveBeenCalledWith('runner-1', {
      jobName: 'classifyre-extract-abc',
      namespace: 'classifyre-dev',
    });
  });

  it('leaves Jobs alone when Kubernetes says they are already gone', async () => {
    // The overwhelming majority of terminal rows are ordinary finished runs
    // whose Job vanished long ago; this sweep runs every few minutes and must
    // not issue a delete per row per tick.
    const h = harness([terminal()], { active: () => false });

    const result = await h.service.reapOrphanedJobs();

    expect(result.reaped).toBe(0);
    expect(h.k8sJobs.stopRunnerJob).not.toHaveBeenCalled();
  });

  it('only considers runners terminal for longer than the grace period', async () => {
    const h = harness([]);

    await h.service.reapOrphanedJobs();

    const where = h.getWhere();
    // A pod that exited normally is torn down moments after the API records
    // the outcome; reaping inside that window races a clean exit.
    expect(where.completedAt.lt.getTime()).toBeLessThanOrEqual(
      Date.now() - 60_000,
    );
    expect(where.jobName).toEqual({ not: null });
    expect(where.status.in).toContain(RunnerStatus.ERROR);
    // Never touch a run that is still going.
    expect(where.status.in).not.toContain(RunnerStatus.RUNNING);
    expect(where.status.in).not.toContain(RunnerStatus.PENDING);
  });

  it('keeps sweeping when one Job cannot be reached', async () => {
    const h = harness([
      terminal({ id: 'runner-1', jobName: 'job-1' }),
      terminal({ id: 'runner-2', jobName: 'job-2' }),
    ]);
    h.k8sJobs.isJobActive.mockImplementationOnce(() =>
      Promise.reject(new Error('apiserver unreachable')),
    );

    const result = await h.service.reapOrphanedJobs();

    expect(result.reaped).toBe(1);
    expect(h.stopped).toEqual(['runner-2']);
  });
});
