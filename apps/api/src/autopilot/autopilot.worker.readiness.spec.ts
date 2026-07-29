import { AgentKind } from '@prisma/client';
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
  const DIRTY_AT = new Date('2026-07-29T12:00:00.000Z');
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

    it('preserves targeted agent scope and focus when re-queueing', async () => {
      build({ matchQueue: 1 });
      prisma.instanceSettings = {
        findUnique: jest.fn().mockResolvedValue({
          aiEnabled: true,
          autopilotInquiryEnabled: true,
          autopilotCaseEnabled: true,
          autopilotConfigEnabled: true,
          autopilotDetectorEnabled: true,
          autopilotEscalationEnabled: true,
        }),
      };

      await (worker as any).runCycle({
        sourceId: 's1',
        runnerId: 'r1',
        corpus: false,
        cycleKey: 'scan:s1:r1',
        trigger: 'express',
        manual: false,
        instruction: 'inspect extraction failure',
        caseId: 'case-1',
        only: [AgentKind.CONFIG],
        expressReason: 'scan failed',
        readinessAttempts: 0,
      });

      expect(sent[0].data).toMatchObject({
        sourceId: 's1',
        runnerId: 'r1',
        cycleKey: 'scan:s1:r1',
        agentKinds: [AgentKind.CONFIG],
        caseId: 'case-1',
        instruction: 'inspect extraction failure',
        expressReason: 'scan failed',
        readinessAttempts: 1,
      });
    });

    // A permanently backed-up embedding queue must degrade the run, never
    // deadlock the autopilot outright.
    it('gives up waiting and proceeds after the requeue budget', async () => {
      build({
        pendingEmbedJobs: 50,
        dirty: [{ id: 's1', name: 'A', autopilotDirtyAt: DIRTY_AT }],
      });
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

  describe('acknowledging the dirty set', () => {
    const read = () =>
      (worker as any).readDirtySources() as Promise<
        Array<{ id: string; name: string; autopilotDirtyAt: Date }>
      >;
    const acknowledge = (
      dirty: Array<{ id: string; name: string; autopilotDirtyAt: Date }>,
    ) => (worker as any).acknowledgeDirtySources(dirty) as Promise<void>;

    it('reads the batch without clearing it, then acknowledges it explicitly', async () => {
      const secondDirtyAt = new Date('2026-07-29T12:00:01.000Z');
      build({
        dirty: [
          { id: 's1', name: 'A', autopilotDirtyAt: DIRTY_AT },
          { id: 's2', name: 'B', autopilotDirtyAt: secondDirtyAt },
        ],
      });

      const dirty = await read();

      expect(dirty).toEqual([
        { id: 's1', name: 'A', autopilotDirtyAt: DIRTY_AT },
        { id: 's2', name: 'B', autopilotDirtyAt: secondDirtyAt },
      ]);
      expect(prisma.source.updateMany).not.toHaveBeenCalled();

      await acknowledge(dirty);

      expect(prisma.source.updateMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { id: 's1', autopilotDirtyAt: DIRTY_AT },
            { id: 's2', autopilotDirtyAt: secondDirtyAt },
          ],
        },
        data: { autopilotDirtyAt: null },
      });
    });

    it('uses the observed timestamp so a newer scan cannot be cleared', async () => {
      build({
        dirty: [{ id: 's1', name: 'A', autopilotDirtyAt: DIRTY_AT }],
      });

      await acknowledge(await read());

      const where = prisma.source.updateMany.mock.calls[0][0].where;
      expect(where).toEqual({
        OR: [{ id: 's1', autopilotDirtyAt: DIRTY_AT }],
      });
    });

    it('does not issue a write when nothing is dirty', async () => {
      build({ dirty: [] });

      const dirty = await read();
      await acknowledge(dirty);

      expect(dirty).toEqual([]);
      expect(prisma.source.updateMany).not.toHaveBeenCalled();
    });

    it('does not acknowledge a batch when an agent fails transiently', async () => {
      build({
        dirty: [{ id: 's1', name: 'A', autopilotDirtyAt: DIRTY_AT }],
      });
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
      (worker as any).runAgent = jest
        .fn()
        .mockRejectedValue(new Error('provider unavailable'));

      await expect(
        (worker as any).runCycle({
          sourceId: null,
          runnerId: null,
          corpus: true,
          cycleKey: 'corpus:x',
          trigger: 'corpus',
          manual: false,
          instruction: null,
        }),
      ).rejects.toThrow('provider unavailable');

      expect(prisma.source.updateMany).not.toHaveBeenCalled();
    });

    it('acknowledges the observed batch after every enabled agent succeeds', async () => {
      build({
        dirty: [{ id: 's1', name: 'A', autopilotDirtyAt: DIRTY_AT }],
      });
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
        cycleKey: 'corpus:x',
        trigger: 'corpus',
        manual: false,
        instruction: null,
      });

      expect(prisma.source.updateMany).toHaveBeenCalledWith({
        where: { OR: [{ id: 's1', autopilotDirtyAt: DIRTY_AT }] },
        data: { autopilotDirtyAt: null },
      });
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
