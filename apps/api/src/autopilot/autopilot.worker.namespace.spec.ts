import { AutopilotWorker } from './autopilot.worker';
import { pgBossSchemaForSlug } from '../scheduler/pg-boss.service';

/**
 * BUG D (Enron second attempt), now solved structurally. Previously pg-boss
 * connected with the raw DATABASE_URL and defaulted to one shared `pgboss`
 * schema, so every namespace on the same physical database shared one job
 * table and a worker could execute another namespace's jobs. The multi-tenant
 * model gives EACH namespace its own pg-boss instance in its own
 * `pgboss_<slug>` schema, so a job can only ever be dequeued by its own
 * namespace's worker — the old per-job source/runner guard is no longer needed.
 */
describe('pgBossSchemaForSlug (per-namespace pg-boss isolation)', () => {
  it('derives a per-namespace pg-boss schema from the slug', () => {
    expect(pgBossSchemaForSlug('eron-email-no-2')).toBe(
      'pgboss_eron_email_no_2',
    );
  });

  it('sanitizes exotic slugs into a valid identifier', () => {
    expect(pgBossSchemaForSlug('ns-weird.name')).toBe('pgboss_ns_weird_name');
  });

  it('caps the schema name at 50 characters', () => {
    expect(pgBossSchemaForSlug('a'.repeat(80)).length).toBeLessThanOrEqual(50);
  });

  it('does not alias long slugs that share the same prefix', () => {
    const prefix = 'a'.repeat(49);
    expect(pgBossSchemaForSlug(`${prefix}b`)).not.toBe(
      pgBossSchemaForSlug(`${prefix}c`),
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
