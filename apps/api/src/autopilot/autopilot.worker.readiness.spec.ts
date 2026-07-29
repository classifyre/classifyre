import { AutopilotWorker } from './autopilot.worker';
import {
  AUTOPILOT_CORPUS_SINGLETON_KEY,
  AUTOPILOT_MAX_READINESS_REQUEUES,
} from './autopilot.constants';

/**
 * The corpus cycle: what it consumes, and what it waits for.
 *
 * The cycle used to wait only on inquiry matching. Evidence analysis — which
 * produces the importance scores the entire TRIAGE DOCTRINE is built on — was
 * never waited for, so `findings.ranked` was routinely read while every finding
 * still scored 0. That does not merely lose signal: an unscored finding is
 * indistinguishable from a genuinely unimportant one, so running early inverts
 * the ranking the agent is told to trust.
 */
describe('AutopilotWorker readiness and batch consumption', () => {
  let prisma: any;
  let sent: Array<{ data: any; opts: any }>;
  let worker: AutopilotWorker;

  const build = (
    over: {
      pendingEmbedJobs?: number | null;
      recalibrationScheduled?: boolean;
      matchQueue?: number;
      dirty?: any[];
    } = {},
  ) => {
    sent = [];
    prisma = {
      source: {
        findMany: jest.fn().mockResolvedValue(over.dirty ?? []),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const pgBoss = {
      getBossAsync: jest.fn().mockResolvedValue({
        getQueueStats: jest.fn().mockResolvedValue({
          queuedCount: over.matchQueue ?? 0,
          activeCount: 0,
          deferredCount: 0,
        }),
        send: (_q: string, data: any, opts: any) => {
          sent.push({ data, opts });
          return Promise.resolve('job');
        },
      }),
    };
    const embeddings = {
      status: jest.fn().mockResolvedValue({
        pendingEmbedJobs: over.pendingEmbedJobs ?? 0,
        recalibrationScheduled: over.recalibrationScheduled ?? false,
      }),
    };
    worker = new AutopilotWorker(
      prisma,
      pgBoss as any,
      { recordSkippedRun: jest.fn() } as any,
      {} as any,
      { sourceName: jest.fn().mockResolvedValue('a source') } as any,
      {} as any,
      embeddings as any,
    );
  };

  const blocked = () =>
    (worker as any).readinessBlocked() as Promise<string | null>;

  describe('readinessBlocked', () => {
    it('is clear when both pipelines have drained', async () => {
      build();
      await expect(blocked()).resolves.toBeNull();
    });

    it('waits for inquiry matching', async () => {
      build({ matchQueue: 4 });
      await expect(blocked()).resolves.toBe('Inquiry matching');
    });

    it('waits for evidence analysis', async () => {
      build({ pendingEmbedJobs: 120 });
      await expect(blocked()).resolves.toBe('Evidence analysis');
    });

    // Scores are only corpus-relative once recalibration has run, which is why
    // EmbeddingQueueService defers its own pass while inference drains.
    it('waits for a scheduled recalibration too', async () => {
      build({ recalibrationScheduled: true });
      await expect(blocked()).resolves.toBe('Evidence analysis');
    });

    it('treats an unconfigured semantic stack as ready, not as blocked', async () => {
      build();
      (worker as any).embeddings.status = jest
        .fn()
        .mockRejectedValue(new Error('embeddings not configured'));

      await expect(blocked()).resolves.toBeNull();
    });

    it('treats a null pending count as ready', async () => {
      build({ pendingEmbedJobs: null });
      await expect(blocked()).resolves.toBeNull();
    });
  });

  describe('the wait is bounded', () => {
    const runCycle = (readinessAttempts: number) =>
      (worker as any).runCycle({
        sourceId: null,
        runnerId: null,
        corpus: true,
        cycleKey: 'corpus:x',
        trigger: 'corpus',
        manual: false,
        instruction: null,
        readinessAttempts,
      }) as Promise<void>;

    const withSettings = (aiEnabled = true) => {
      prisma.instanceSettings = {
        findUnique: jest.fn().mockResolvedValue({
          aiEnabled,
          autopilotInquiryEnabled: false,
          autopilotCaseEnabled: false,
          autopilotConfigEnabled: false,
          autopilotDetectorEnabled: false,
          autopilotEscalationEnabled: false,
        }),
      };
    };

    it('re-queues under the corpus key, incrementing the attempt count', async () => {
      build({ pendingEmbedJobs: 50 });
      withSettings();
      // One agent enabled so the cycle is not short-circuited by the gate.
      prisma.instanceSettings.findUnique.mockResolvedValue({
        aiEnabled: true,
        autopilotInquiryEnabled: true,
        autopilotCaseEnabled: false,
        autopilotConfigEnabled: false,
        autopilotDetectorEnabled: false,
        autopilotEscalationEnabled: false,
      });

      await runCycle(0);

      expect(sent).toHaveLength(1);
      expect(sent[0].opts.singletonKey).toBe(AUTOPILOT_CORPUS_SINGLETON_KEY);
      expect(sent[0].data.readinessAttempts).toBe(1);
      expect(sent[0].data.corpus).toBe(true);
      // It must NOT have consumed the batch while deferring.
      expect(prisma.source.updateMany).not.toHaveBeenCalled();
    });

    // A permanently backed-up embedding queue must degrade the run, never
    // deadlock the autopilot outright.
    it('gives up waiting and proceeds after the requeue budget', async () => {
      build({ pendingEmbedJobs: 50, dirty: [{ id: 's1', name: 'A' }] });
      withSettings();
      prisma.instanceSettings.findUnique.mockResolvedValue({
        aiEnabled: true,
        autopilotInquiryEnabled: true,
        autopilotCaseEnabled: false,
        autopilotConfigEnabled: false,
        autopilotDetectorEnabled: false,
        autopilotEscalationEnabled: false,
      });
      (worker as any).runAgent = jest.fn().mockResolvedValue(undefined);

      await runCycle(AUTOPILOT_MAX_READINESS_REQUEUES);

      expect(sent).toHaveLength(0);
      const scope = (worker as any).runAgent.mock.calls[0][4];
      expect(scope.evidenceAnalysisPending).toBe(true);
    });
  });

  describe('consuming the dirty set', () => {
    const consume = () =>
      (worker as any).consumeDirtySources() as Promise<
        Array<{ id: string; name: string }>
      >;

    it('returns the batch and clears it', async () => {
      build({
        dirty: [
          { id: 's1', name: 'A' },
          { id: 's2', name: 'B' },
        ],
      });

      await expect(consume()).resolves.toEqual([
        { id: 's1', name: 'A' },
        { id: 's2', name: 'B' },
      ]);
      expect(prisma.source.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1', 's2'] } },
        data: { autopilotDirtyAt: null },
      });
    });

    // Clearing by id, not with a blanket `WHERE autopilot_dirty_at IS NOT
    // NULL`: a scan finishing mid-cycle must enrol in the NEXT batch rather
    // than being silently swallowed by this one.
    it('clears exactly the ids it read, never everything dirty', async () => {
      build({ dirty: [{ id: 's1', name: 'A' }] });

      await consume();

      const where = prisma.source.updateMany.mock.calls[0][0].where;
      expect(where).toEqual({ id: { in: ['s1'] } });
    });

    it('does not issue a write when nothing is dirty', async () => {
      build({ dirty: [] });

      await expect(consume()).resolves.toEqual([]);
      expect(prisma.source.updateMany).not.toHaveBeenCalled();
    });

    // A readiness requeue always inserts (it must, or a deferred cycle is
    // lost), so a corpus job can outlive the batch it was queued for. Running
    // five agents over "all sources" to rediscover nothing is exactly the churn
    // this cadence exists to remove.
    it('skips a corpus cycle that has no newly scanned sources', async () => {
      build({ dirty: [] });
      prisma.instanceSettings = {
        findUnique: jest.fn().mockResolvedValue({
          aiEnabled: true,
          autopilotInquiryEnabled: true,
          autopilotCaseEnabled: true,
          autopilotConfigEnabled: false,
          autopilotDetectorEnabled: false,
          autopilotEscalationEnabled: false,
        }),
      };
      (worker as any).runAgent = jest.fn().mockResolvedValue(undefined);

      await (worker as any).runCycle({
        sourceId: null,
        runnerId: null,
        corpus: true,
        cycleKey: 'corpus:x',
        trigger: 'corpus',
        manual: false,
        instruction: null,
      });

      expect((worker as any).runAgent).not.toHaveBeenCalled();
    });

    it('still runs a manual all-sources review with an empty batch', async () => {
      build({ dirty: [] });
      prisma.instanceSettings = {
        findUnique: jest.fn().mockResolvedValue({
          aiEnabled: true,
          autopilotInquiryEnabled: true,
          autopilotCaseEnabled: false,
          autopilotConfigEnabled: false,
          autopilotDetectorEnabled: false,
          autopilotEscalationEnabled: false,
        }),
      };
      (worker as any).runAgent = jest.fn().mockResolvedValue(undefined);

      await (worker as any).runCycle({
        sourceId: null,
        runnerId: null,
        corpus: true,
        cycleKey: 'manual:x',
        trigger: 'manual',
        manual: true,
        instruction: 'look at everything',
      });

      expect((worker as any).runAgent).toHaveBeenCalled();
    });
  });
});
