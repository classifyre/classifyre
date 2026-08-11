import { AgentKind } from '@prisma/client';
import { AutopilotWorker } from './autopilot.worker';
import {
  AUTOPILOT_COALESCE_WINDOW_SECONDS,
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
      openFindings?: number;
      analyzedFindings?: number;
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
      {
        sourceName: jest.fn().mockResolvedValue('a source'),
        evidenceCoverage: jest.fn().mockResolvedValue({
          open: over.openFindings ?? 0,
          analyzed: over.analyzedFindings ?? 0,
        }),
      } as any,
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

    /**
     * The gate is about the DATA, not the queue.
     *
     * It used to be "is the embedding queue non-empty", which under continuous
     * ingestion is permanently true. A live 151-source namespace sat at 38%
     * coverage while scans kept arriving, and the harness ran one investigation
     * cycle in two hours — every other one deferred, requeued, and found the
     * dirty set already claimed.
     */
    it('waits while too little of the corpus is scored to rank it', async () => {
      build({
        pendingEmbedJobs: 120,
        openFindings: 1000,
        analyzedFindings: 50,
      });
      await expect(blocked()).resolves.toMatch(/only 50 of 1000/);
    });

    it('proceeds once coverage is usable, even with inference still running', async () => {
      // 38% — the live figure that used to defer indefinitely.
      build({
        pendingEmbedJobs: 5000,
        openFindings: 135772,
        analyzedFindings: 51455,
      });
      await expect(blocked()).resolves.toBeNull();
    });

    /**
     * A ratio has a growing denominator, so where ingestion outpaces analysis
     * it falls over time and the gate re-engages exactly when the corpus is
     * largest. The live 151-source namespace reached 442,613 scored against
     * 1,914,477 open — 23%, blocked — and stopped investigating for three
     * hours, with 55 cycles queued behind the gate. Half a million scored
     * findings is not "too little to reason from"; it is more than a cycle can
     * read many times over.
     */
    it('proceeds on a huge corpus whose ratio is low but whose volume is not', async () => {
      build({
        pendingEmbedJobs: 20000,
        openFindings: 1914477,
        analyzedFindings: 442613,
      });
      await expect(blocked()).resolves.toBeNull();
    });

    // The ratio still governs corpora too small for the absolute floor to
    // apply, where a handful of scores genuinely cannot support ranking.
    it('still waits on a small corpus with almost nothing scored', async () => {
      build({ pendingEmbedJobs: 50, openFindings: 400, analyzedFindings: 12 });
      await expect(blocked()).resolves.toMatch(/only 12 of 400/);
    });

    it('proceeds on a small corpus once a quarter of it is scored', async () => {
      build({ pendingEmbedJobs: 50, openFindings: 400, analyzedFindings: 120 });
      await expect(blocked()).resolves.toBeNull();
    });

    it('proceeds when there is nothing to score', async () => {
      build({ pendingEmbedJobs: 120, openFindings: 0, analyzedFindings: 0 });
      await expect(blocked()).resolves.toBeNull();
    });

    // It used to. And that closed the gate permanently on any busy instance:
    // handleRecalibration re-defers itself while inference drains, so with
    // scans landing continuously the recalibrate queue is never empty. Every
    // cycle burned all five requeues — five minutes of delay — and then ran
    // flagged as degraded. Recalibration re-normalises existing scores; it does
    // not create them, so it is not worth holding a cycle for.
    it('does NOT wait for a scheduled recalibration', async () => {
      build({ recalibrationScheduled: true });
      await expect(blocked()).resolves.toBeNull();
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

    const withSettings = () => {
      prisma.instanceSettings = {
        findUnique: jest.fn().mockResolvedValue({
          harnessAiProviderConfigId: 'p1',
          autopilotInquiryEnabled: false,
          autopilotCaseEnabled: false,
          autopilotConfigEnabled: false,
          autopilotDetectorEnabled: false,
          autopilotEscalationEnabled: false,
        }),
      };
    };

    it('re-queues under the corpus key, incrementing the attempt count', async () => {
      build({ pendingEmbedJobs: 50, openFindings: 1000, analyzedFindings: 10 });
      withSettings();
      // One agent enabled so the cycle is not short-circuited by the gate.
      prisma.instanceSettings.findUnique.mockResolvedValue({
        harnessAiProviderConfigId: 'p1',
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

    /**
     * `singletonKey` alone dedupes nothing on a pg-boss 12 `standard` queue —
     * every single-job-per-key index is predicated on the queue policy. So each
     * requeue inserted a NEW job, and with a fresh corpus cycle arriving every
     * window each started its own chain counting to five. A live 151-source
     * namespace accumulated 29 completed cycle jobs across attempts 1..5, of
     * which exactly one reached the agents; the rest found the dirty set
     * already claimed and exited.
     */
    it('gives the requeue a slot width so chains collapse instead of multiplying', async () => {
      build({ pendingEmbedJobs: 50, openFindings: 1000, analyzedFindings: 10 });
      withSettings();
      prisma.instanceSettings.findUnique.mockResolvedValue({
        harnessAiProviderConfigId: 'p1',
        autopilotInquiryEnabled: true,
        autopilotCaseEnabled: false,
        autopilotConfigEnabled: false,
        autopilotDetectorEnabled: false,
        autopilotEscalationEnabled: false,
      });

      await runCycle(0);

      expect(sent[0].opts.singletonSeconds).toBe(
        AUTOPILOT_COALESCE_WINDOW_SECONDS,
      );
      // NOT singletonNextSlot: unlike the enqueue path, a collision here means
      // a cycle is already QUEUED and will read the same shared dirty set, so
      // nothing is stranded by dropping this retry. Deferring instead stacked
      // retries into successive slots — 55 queued cycles on a live instance.
      expect(sent[0].opts.singletonNextSlot).toBeUndefined();
    });

    it('preserves targeted agent scope and focus when re-queueing', async () => {
      build({ matchQueue: 1 });
      prisma.instanceSettings = {
        findUnique: jest.fn().mockResolvedValue({
          harnessAiProviderConfigId: 'p1',
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
        // Measured coverage, not the gate, is what flags the run as degraded:
        // 10 of 100 open findings scored.
        openFindings: 100,
        analyzedFindings: 10,
        dirty: [{ id: 's1', name: 'A', autopilotDirtyAt: DIRTY_AT }],
      });
      withSettings();
      prisma.instanceSettings.findUnique.mockResolvedValue({
        harnessAiProviderConfigId: 'p1',
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

    // The flag used to be `blocked != null` — "a queue was busy when we
    // looked". On a busy instance that was every cycle, so the missions were
    // permanently told to "treat findings.ranked as partial and prefer
    // deferring to concluding" even when every finding in scope was scored.
    it('does not flag a run as degraded when the findings are actually scored', async () => {
      build({
        pendingEmbedJobs: 50,
        openFindings: 100,
        analyzedFindings: 100,
        dirty: [{ id: 's1', name: 'A', autopilotDirtyAt: DIRTY_AT }],
      });
      withSettings();
      prisma.instanceSettings.findUnique.mockResolvedValue({
        harnessAiProviderConfigId: 'p1',
        autopilotInquiryEnabled: true,
        autopilotCaseEnabled: false,
        autopilotConfigEnabled: false,
        autopilotDetectorEnabled: false,
        autopilotEscalationEnabled: false,
      });
      (worker as any).runAgent = jest.fn().mockResolvedValue(undefined);

      await runCycle(AUTOPILOT_MAX_READINESS_REQUEUES);

      const scope = (worker as any).runAgent.mock.calls[0][4];
      expect(scope.evidenceAnalysisPending).toBe(false);
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
          harnessAiProviderConfigId: 'p1',
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
          harnessAiProviderConfigId: 'p1',
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
          harnessAiProviderConfigId: 'p1',
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
          harnessAiProviderConfigId: 'p1',
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
