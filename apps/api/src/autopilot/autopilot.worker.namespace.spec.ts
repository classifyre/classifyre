import { AutopilotWorker } from './autopilot.worker';
import { pgBossSchemaForDatabaseUrl } from '../scheduler/pg-boss.service';

/**
 * BUG D (Enron second attempt). Autopilot agent cycles executed in a namespace
 * against scan-completed events belonging to a different namespace: pg-boss
 * connects with the raw DATABASE_URL and defaults to one shared `pgboss`
 * schema, so every namespace on the same physical database shared one job
 * table, and the worker never checked that a job's source/runner exists in
 * its own schema. Two fixes, both covered here:
 *
 *  1. pg-boss gets a per-namespace schema derived from the Prisma `?schema=`
 *     URL param.
 *  2. The worker drops jobs whose source/runner is unknown in its namespace.
 */
describe('pgBossSchemaForDatabaseUrl (BUG D)', () => {
  it('derives a per-namespace pg-boss schema from the Prisma schema param', () => {
    expect(
      pgBossSchemaForDatabaseUrl(
        'postgresql://u:p@localhost:5432/db?schema=ns_eron_email_no_2',
      ),
    ).toBe('pgboss_ns_eron_email_no_2');
  });

  it('returns undefined without a schema param (single-tenant default)', () => {
    expect(
      pgBossSchemaForDatabaseUrl('postgresql://u:p@localhost:5432/db'),
    ).toBeUndefined();
  });

  it('returns undefined for missing or unparsable URLs', () => {
    expect(pgBossSchemaForDatabaseUrl(undefined)).toBeUndefined();
    expect(pgBossSchemaForDatabaseUrl('not a url')).toBeUndefined();
  });

  it('sanitizes exotic namespace names into a valid identifier', () => {
    expect(
      pgBossSchemaForDatabaseUrl(
        'postgresql://u:p@localhost:5432/db?schema=ns-weird.name',
      ),
    ).toBe('pgboss_ns_weird_name');
  });
});

describe('AutopilotWorker namespace guard (BUG D)', () => {
  const buildWorker = (opts: {
    sourceExists: boolean;
    runnerExists: boolean;
  }) => {
    const prisma = {
      source: {
        findUnique: jest
          .fn()
          .mockResolvedValue(opts.sourceExists ? { id: 's1' } : null),
      },
      runner: {
        findUnique: jest
          .fn()
          .mockResolvedValue(opts.runnerExists ? { id: 'r1' } : null),
      },
    };
    const worker = new AutopilotWorker(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { worker, prisma };
  };

  const belongs = (worker: AutopilotWorker, sourceId: string | null, runnerId: string | null) =>
    (worker as any).jobBelongsToThisNamespace(sourceId, runnerId) as Promise<boolean>;

  it('accepts jobs whose source and runner exist in this namespace', async () => {
    const { worker } = buildWorker({ sourceExists: true, runnerExists: true });
    await expect(belongs(worker, 's1', 'r1')).resolves.toBe(true);
  });

  it('rejects jobs referencing a source from another namespace', async () => {
    const { worker } = buildWorker({ sourceExists: false, runnerExists: true });
    await expect(belongs(worker, 'foreign-source', 'r1')).resolves.toBe(false);
  });

  it('rejects jobs referencing a runner from another namespace', async () => {
    const { worker } = buildWorker({ sourceExists: true, runnerExists: false });
    await expect(belongs(worker, 's1', 'foreign-runner')).resolves.toBe(false);
  });

  it('accepts jobs without source/runner (manual and dream cycles)', async () => {
    const { worker, prisma } = buildWorker({
      sourceExists: false,
      runnerExists: false,
    });
    await expect(belongs(worker, null, null)).resolves.toBe(true);
    expect(prisma.source.findUnique).not.toHaveBeenCalled();
    expect(prisma.runner.findUnique).not.toHaveBeenCalled();
  });

  it('handle() drops a foreign-namespace job without running a cycle', async () => {
    const { worker } = buildWorker({ sourceExists: false, runnerExists: false });
    const runCycle = jest
      .spyOn(worker as any, 'runCycle')
      .mockResolvedValue(undefined);

    await (worker as any).handle([
      { data: { sourceId: 'foreign-source', runnerId: 'foreign-runner' } },
    ]);

    expect(runCycle).not.toHaveBeenCalled();
  });

  it('handle() runs the cycle for a job owned by this namespace', async () => {
    const { worker } = buildWorker({ sourceExists: true, runnerExists: true });
    const runCycle = jest
      .spyOn(worker as any, 'runCycle')
      .mockResolvedValue(undefined);

    await (worker as any).handle([{ data: { sourceId: 's1', runnerId: 'r1' } }]);

    expect(runCycle).toHaveBeenCalledTimes(1);
  });
});
