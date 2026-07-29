import { AgentKind, RunnerStatus } from '@prisma/client';
import { CorrelationWorker } from './correlation.worker';
import {
  AI_ACTOR,
  AUTOPILOT_COALESCE_WINDOW_SECONDS,
  AUTOPILOT_CORPUS_SINGLETON_KEY,
} from '../autopilot/autopilot.constants';

/**
 * Cadence. A completed scan used to enqueue its own autopilot cycle, debounced
 * only per source (`singletonKey: autopilot:<sourceId>`). Onboarding 151
 * sources therefore produced 151 independent cycles of five agents apiece —
 * 137 agent runs in fifteen hours, each reasoning over whatever fraction of the
 * corpus had landed, none aware of the others.
 *
 * Scans now mark their source dirty and enqueue one globally-keyed job, so the
 * batch coalesces in pg-boss. Three things still skip the window: a
 * high-importance finding, a hit on something the operator authored, and an
 * operational failure.
 */
describe('CorrelationWorker autopilot hand-off', () => {
  let sent: Array<{ queue: string; data: any; opts: any }>;
  let prisma: any;
  let worker: CorrelationWorker;

  const build = (over: Partial<Record<string, any>> = {}) => {
    sent = [];
    prisma = {
      source: {
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(over.dirtyCount ?? 1),
        findUnique: jest
          .fn()
          .mockResolvedValue(over.source ?? { consecutiveFailures: 0 }),
      },
      runner: {
        findUnique: jest.fn().mockResolvedValue(
          over.runner ?? {
            status: RunnerStatus.COMPLETED,
            assetsWithoutText: 0,
            assetsCreated: 10,
          },
        ),
      },
      inquiry: { findFirst: jest.fn().mockResolvedValue(over.inquiry ?? null) },
      finding: { findFirst: jest.fn().mockResolvedValue(over.finding ?? null) },
    };
    const pgBoss = {
      getBossAsync: jest.fn().mockResolvedValue({
        send: (queue: string, data: any, opts: any) => {
          sent.push({ queue, data, opts });
          return Promise.resolve('job-id');
        },
      }),
    };
    worker = new CorrelationWorker(pgBoss as any, prisma, {} as any);
  };

  const handOff = (sourceId = 's1') =>
    (worker as any).handOffToAutopilot(
      sourceId,
      'r1',
      `scan:${sourceId}:r1`,
    ) as Promise<void>;

  describe('the ordinary path batches', () => {
    it('marks the source dirty rather than enqueuing its own cycle', async () => {
      build();

      await handOff();

      expect(prisma.source.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's1' },
          data: { autopilotDirtyAt: expect.any(Date) },
        }),
      );
    });

    it('uses ONE global singleton key so concurrent scans fold together', async () => {
      build();

      await handOff('s1');
      await handOff('s2');
      await handOff('s3');

      const keys = sent.map((s) => s.opts.singletonKey);
      expect(keys).toEqual([
        AUTOPILOT_CORPUS_SINGLETON_KEY,
        AUTOPILOT_CORPUS_SINGLETON_KEY,
        AUTOPILOT_CORPUS_SINGLETON_KEY,
      ]);
      // Never per-source — that key is what produced 151 cycles.
      expect(keys.some((k) => k.includes('s1'))).toBe(false);
    });

    it('sends a corpus-scoped job, not a single-source one', async () => {
      build();

      await handOff();

      expect(sent[0].data.corpus).toBe(true);
      expect(sent[0].data.sourceId).toBeUndefined();
    });

    it('waits out the coalescing window', async () => {
      build({ dirtyCount: 3 });

      await handOff();

      expect(sent[0].opts.startAfter).toBe(AUTOPILOT_COALESCE_WINDOW_SECONDS);
    });

    // The load-bearing detail, and the one that is easy to get wrong: in
    // pg-boss 12 every single-job-per-key index is predicated on the queue
    // POLICY (short/singleton/stately/exclusive), and this queue is created
    // with the default `standard`. A bare singletonKey therefore dedupes
    // nothing — each scan would still get its own cycle, just corpus-scoped
    // instead of source-scoped, which is strictly worse. `singletonSeconds`
    // drives the policy-independent `job_i4 (name, singleton_on,
    // singleton_key)` index instead, with ON CONFLICT DO NOTHING.
    it('sets singletonSeconds — a bare singletonKey is inert on this queue', async () => {
      build();

      await handOff();

      expect(sent[0].opts.singletonSeconds).toBe(
        AUTOPILOT_COALESCE_WINDOW_SECONDS,
      );
    });

    it('throttles express cycles per source as well', async () => {
      build({ finding: { id: 'f1', importanceScore: 0.95 } });

      await handOff();

      expect(sent[0].opts.singletonSeconds).toBe(
        AUTOPILOT_COALESCE_WINDOW_SECONDS,
      );
    });
  });

  describe('the express lane skips the window', () => {
    it('escalates a failed scan to the config agent, not the investigators', async () => {
      build({
        runner: {
          status: RunnerStatus.ERROR,
          assetsWithoutText: 0,
          assetsCreated: 0,
        },
      });

      await handOff();

      expect(sent[0].data.expressReason).toMatch(/scan failed/);
      expect(sent[0].data.agentKinds).toEqual([AgentKind.CONFIG]);
      expect(sent[0].opts.singletonKey).toBe('autopilot:express:s1');
    });

    it('escalates a source failing repeatedly', async () => {
      build({ source: { consecutiveFailures: 5 } });

      await handOff();

      expect(sent[0].data.expressReason).toMatch(/failed 5 scans in a row/);
      expect(sent[0].data.agentKinds).toEqual([AgentKind.CONFIG]);
    });

    // A run can report success having read none of its assets' actual content.
    it('escalates a scan that extracted no text at all', async () => {
      build({
        runner: {
          status: RunnerStatus.COMPLETED,
          assetsCreated: 40,
          assetsWithoutText: 40,
        },
      });

      await handOff();

      expect(sent[0].data.expressReason).toMatch(/extracted no text/);
      expect(sent[0].data.agentKinds).toEqual([AgentKind.CONFIG]);
    });

    it('expedites a hit on an operator-authored inquiry', async () => {
      build({ inquiry: { id: 'q1', title: 'Board travel to Cayman' } });

      await handOff();

      expect(sent[0].data.expressReason).toMatch(/Board travel to Cayman/);
      // The full pipeline, not just config — this is investigative.
      expect(sent[0].data.agentKinds).toBeUndefined();
    });

    it('only counts inquiries the operator wrote, never the agent’s own', async () => {
      build({ inquiry: null });

      await handOff();

      expect(prisma.inquiry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ createdBy: { not: AI_ACTOR } }),
        }),
      );
    });

    it('expedites a finding the analyzer scored as important', async () => {
      build({ finding: { id: 'f1', importanceScore: 0.91 } });

      await handOff();

      expect(sent[0].data.expressReason).toMatch(/high-importance finding/);
    });

    // Importance comes from the evidence analyzer. If it has not run, the score
    // is 0 for every finding — so no express trigger fires and the source
    // simply joins the batch, which is the safe direction to fail in.
    it('falls back to the batch when nothing is scored yet', async () => {
      build({ finding: null });

      await handOff();

      expect(sent[0].data.corpus).toBe(true);
      expect(sent[0].data.expressReason).toBeUndefined();
    });

    it('still enrols an expedited source in the batch', async () => {
      build({ finding: { id: 'f1', importanceScore: 0.99 } });

      await handOff();

      // The dirty stamp happens before the express decision, so the source is
      // still reviewed in corpus context by the next batch.
      expect(prisma.source.update).toHaveBeenCalled();
    });
  });

  it('never lets a queue failure break the scan pipeline', async () => {
    build();
    prisma.source.update.mockRejectedValue(new Error('db gone'));

    await expect(handOff()).resolves.toBeUndefined();
  });
});
