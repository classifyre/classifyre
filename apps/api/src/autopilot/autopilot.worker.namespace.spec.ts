import { AutopilotWorker } from './autopilot.worker';
import { pgBossSchemaForId } from '../scheduler/pg-boss.service';

/**
 * BUG D (Enron second attempt), now solved structurally. Previously pg-boss
 * connected with the raw DATABASE_URL and defaulted to one shared `pgboss`
 * schema, so every namespace on the same physical database shared one job
 * table and a worker could execute another namespace's jobs. The multi-tenant
 * model gives EACH namespace its own pg-boss instance in its own
 * `pgboss_<uuid>` schema (derived from the immutable namespace UUID so a slug
 * edit never orphans a job schema), so a job can only ever be dequeued by its
 * own namespace's worker — the old per-job source/runner guard is no longer
 * needed.
 */
describe('pgBossSchemaForId (per-namespace pg-boss isolation)', () => {
  it('derives a per-namespace pg-boss schema from the UUID', () => {
    expect(pgBossSchemaForId('3b5c41bc-fb84-4251-985f-0a16d0449c85')).toBe(
      'pgboss_3b5c41bcfb844251985f0a16d0449c85',
    );
  });

  it('stays within pg-boss 50-character identifier limit', () => {
    expect(
      pgBossSchemaForId('3b5c41bc-fb84-4251-985f-0a16d0449c85').length,
    ).toBeLessThanOrEqual(50);
  });

  it('gives distinct schemas to distinct namespaces', () => {
    expect(pgBossSchemaForId('3b5c41bc-fb84-4251-985f-0a16d0449c85')).not.toBe(
      pgBossSchemaForId('11111111-2222-3333-4444-555555555555'),
    );
  });
});

describe('AutopilotWorker.handle (no cross-namespace guard needed)', () => {
  const buildWorker = () =>
    new AutopilotWorker(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

  it('runs the cycle for a scan-completed job', async () => {
    const worker = buildWorker();
    const runCycle = jest
      .spyOn(worker as any, 'runCycle')
      .mockResolvedValue(undefined);

    await (worker as any).handle([
      { data: { sourceId: 's1', runnerId: 'r1' } },
    ]);

    expect(runCycle).toHaveBeenCalledTimes(1);
  });

  it('skips jobs with neither source, manual flag, nor explicit agent list', async () => {
    const worker = buildWorker();
    const runCycle = jest
      .spyOn(worker as any, 'runCycle')
      .mockResolvedValue(undefined);

    await (worker as any).handle([{ data: {} }]);

    expect(runCycle).not.toHaveBeenCalled();
  });
});
