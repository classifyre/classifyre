import { CorrelationJobScheduler } from './correlation-job-scheduler.service';
import { CORRELATION_QUEUE } from './correlation.constants';

/**
 * Cadence for whole-graph rebuilds.
 *
 * A rebuild assembles every node and edge at once. Measured on a real corpus
 * (61k nodes / 272k edges) it took 13–24 seconds and drove the API heap from
 * ~160 MB to ~1.8 GB. It used to share the 5-second coalescing window with
 * recomputes, so an active scan — which invalidates correlation continuously —
 * queued the next rebuild before the current one had finished. The API then
 * rebuilt the graph back-to-back for the whole scan and died of a failed
 * allocation; the published versions showed v316 → v322 inside twenty minutes.
 *
 * The invariant these tests hold: the graph window is much wider than a
 * rebuild takes, and wider than the recompute window, so rebuilds cannot
 * overlap themselves.
 */
describe('graph refresh coalescing', () => {
  const OBSERVED_BUILD_SECONDS = 24;

  function build(env: Record<string, string | undefined> = {}) {
    const previous: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(env)) {
      previous[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // The window is captured at module load, so the module has to be
    // re-evaluated after the environment changes. require, not import():
    // Jest's CJS runner cannot service a dynamic import.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reloaded = require('./correlation-job-scheduler.service') as {
      CorrelationJobScheduler: typeof CorrelationJobScheduler;
    };
    const Scheduler = reloaded.CorrelationJobScheduler;

    const sent: Array<{ data: any; opts: any }> = [];
    const pgBoss = {
      getBossAsync: jest.fn().mockResolvedValue({
        send: jest.fn((_queue: string, data: any, opts: any) => {
          sent.push({ data, opts });
          return Promise.resolve('job-id');
        }),
      }),
    };
    return {
      scheduler: new Scheduler(pgBoss as never),
      sent,
      restore: () => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      },
    };
  }

  it('coalesces rebuilds over a window wider than a rebuild takes', async () => {
    const h = build({ CORRELATION_GRAPH_COALESCE_SECONDS: undefined });
    try {
      await h.scheduler.scheduleGraphRefresh('scan ingested assets');

      const [job] = h.sent;
      expect(job.opts.singletonKey).toBe('correlation:graph-refresh');
      expect(job.opts.singletonSeconds).toBeGreaterThan(
        OBSERVED_BUILD_SECONDS * 3,
      );
      // Queued rather than dropped: the last request in a window still runs.
      expect(job.opts.singletonNextSlot).toBe(true);
    } finally {
      h.restore();
    }
  });

  it('keeps the graph window wider than the recompute window', async () => {
    const h = build();
    try {
      await h.scheduler.scheduleGraphRefresh('graph invalidated');
      await h.scheduler.scheduleFull('config changed');

      const [graphJob, recomputeJob] = h.sent;
      expect(graphJob.opts.singletonSeconds).toBeGreaterThan(
        recomputeJob.opts.singletonSeconds,
      );
    } finally {
      h.restore();
    }
  });

  it('is tunable per deployment', async () => {
    const h = build({ CORRELATION_GRAPH_COALESCE_SECONDS: '600' });
    try {
      await h.scheduler.scheduleGraphRefresh('scan ingested assets');
      expect(h.sent[0]?.opts.singletonSeconds).toBe(600);
    } finally {
      h.restore();
    }
  });

  it.each([
    ['empty', ''],
    ['not a number', 'soon'],
    ['zero', '0'],
    ['negative', '-30'],
  ])(
    'ignores a %s override rather than disabling coalescing',
    async (_, raw) => {
      const h = build({ CORRELATION_GRAPH_COALESCE_SECONDS: raw });
      try {
        await h.scheduler.scheduleGraphRefresh('scan ingested assets');
        expect(h.sent[0]?.opts.singletonSeconds).toBeGreaterThan(
          OBSERVED_BUILD_SECONDS * 3,
        );
      } finally {
        h.restore();
      }
    },
  );

  it('still enqueues onto the correlation queue', async () => {
    const h = build();
    try {
      await h.scheduler.scheduleGraphRefresh('scan ingested assets');
      expect(h.sent[0]?.data).toEqual({ refreshGraph: true });
      expect(CORRELATION_QUEUE).toBeTruthy();
    } finally {
      h.restore();
    }
  });
});
