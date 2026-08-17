import { AutopilotWorker } from './autopilot.worker';
import { AiRateLimitError } from '../ai';

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
      {
        // Permissive policy: these suites are about the enable-flag and chain
        // logic, not scheduling. The policy engine has its own spec.
        resolvePolicy: jest.fn().mockResolvedValue({
          triggerMode: 'BATCH',
          waitForMatching: false,
          waitForEvidence: false,
          waitForScans: false,
          minIntervalMinutes: 0,
          maxStalenessHours: 0,
        }),
        lastTriggeredAt: jest.fn().mockResolvedValue(null),
        markTriggered: jest.fn().mockResolvedValue(undefined),
        runBudgetMinutes: jest.fn().mockResolvedValue(null),
      } as any,
    );
  };

  const signals = () =>
    (worker as any).readinessSignals({
      harnessEvidenceUsableFindings: 2000,
      harnessEvidenceUsableCoverage: 0.25,
    }) as Promise<{
      matchingBusy: boolean;
      scansActive: boolean;
      coverage: { open: number; analyzed: number };
      evidence: { usableFindings: number; usableCoverage: number };
    }>;

  /**
   * The signals are gathered once and handed to every agent, which is the whole
   * point of the rework: one agent's precondition must not become every
   * agent's precondition. `agent-policy.service.spec.ts` owns what each agent
   * then DOES with them; this suite owns whether they are read correctly.
   */
  describe('readiness signals', () => {
    it('reports a quiet instance as clear on every axis', async () => {
      build();
      await expect(signals()).resolves.toMatchObject({
        matchingBusy: false,
        scansActive: false,
      });
    });

    it('reports inquiry matching as busy without blocking anything itself', async () => {
      // Previously this single fact deferred the entire cycle. It is now just
      // a fact, and only the agents that declared they need it will wait.
      build({ matchQueue: 4 });
      await expect(signals()).resolves.toMatchObject({ matchingBusy: true });
    });

    it('carries the coverage numbers rather than a verdict', async () => {
      // "Scores are partial" reads very differently at 700/749 than at 1/749,
      // so the numbers travel and the thresholds are applied per agent.
      build({ pendingEmbedJobs: 5, openFindings: 749, analyzedFindings: 700 });

      await expect(signals()).resolves.toMatchObject({
        coverage: { open: 749, analyzed: 700 },
      });
    });

    it('zeroes coverage when nothing is left to analyze', async () => {
      // With no pending work, waiting cannot improve coverage, so the evidence
      // gate has no reason to hold anyone back.
      build({
        pendingEmbedJobs: 0,
        openFindings: 100_000,
        analyzedFindings: 1,
      });

      await expect(signals()).resolves.toMatchObject({
        coverage: { open: 0, analyzed: 0 },
      });
    });

    it('treats an unconfigured semantic stack as clear, not as blocked', async () => {
      build({ pendingEmbedJobs: null });
      await expect(signals()).resolves.toMatchObject({
        coverage: { open: 0, analyzed: 0 },
      });
    });

    it('forwards the operator-configured evidence thresholds', async () => {
      build();
      await expect(signals()).resolves.toMatchObject({
        evidence: { usableFindings: 2000, usableCoverage: 0.25 },
      });
    });

    it('does not treat a counting failure as "everything is busy"', async () => {
      // Failing closed here would stall every gated agent on a transient
      // database error — the deadlock this rework exists to remove.
      build();
      prisma.runner = {
        count: jest.fn().mockRejectedValue(new Error('db down')),
      };

      await expect(signals()).resolves.toMatchObject({ scansActive: false });
    });

    it('reports an active scan so corpus-wide agents can wait for it', async () => {
      build();
      prisma.runner = { count: jest.fn().mockResolvedValue(2) };

      await expect(signals()).resolves.toMatchObject({ scansActive: true });
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

    it('does not acknowledge a batch when an agent fails on its own', async () => {
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
        .mockRejectedValue(new Error('tool blew up'));

      // An agent-specific failure no longer aborts the cycle — its chain-mates
      // still get their turn. What must NOT change is the dirty set: the agent
      // did not finish against these sources, so clearing their marks would
      // drop them for good.
      await (worker as any).runCycle({
        sourceId: null,
        runnerId: null,
        corpus: true,
        cycleKey: 'corpus:x',
        trigger: 'corpus',
        manual: false,
        instruction: null,
      });

      expect(prisma.source.updateMany).not.toHaveBeenCalled();
    });

    it('does not acknowledge a batch when the provider fails', async () => {
      // A provider-level failure still aborts the cycle outright, so pg-boss
      // retries it once the provider recovers.
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
        .mockRejectedValue(new AiRateLimitError('rate limited'));

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
      ).rejects.toThrow(/rate limit/i);

      expect(prisma.source.updateMany).not.toHaveBeenCalled();
    });

    it('keeps the batch dirty when an enabled agent was gated', async () => {
      // The subtle half of per-agent gating. A gated agent has not seen these
      // sources, so clearing the marks on its behalf drops them for good: the
      // next cycle reads the dirty set and finds nothing. Leaving them costs a
      // re-read; clearing them early costs the work.
      build({
        dirty: [{ id: 's1', name: 'A', autopilotDirtyAt: DIRTY_AT }],
        matchQueue: 3,
      });
      prisma.instanceSettings = {
        findUnique: jest.fn().mockResolvedValue({
          harnessAiProviderConfigId: 'p1',
          autopilotInquiryEnabled: true,
          autopilotCaseEnabled: false,
          autopilotConfigEnabled: false,
          autopilotDetectorEnabled: false,
          autopilotEscalationEnabled: false,
          harnessCycleBudgetMinutes: 30,
          harnessEvidenceWarnCoverage: 0.8,
          harnessEvidenceUsableFindings: 2000,
          harnessEvidenceUsableCoverage: 0.25,
        }),
      };
      // The inquiry agent waits for matching, and matching is busy.
      (worker as any).agents.resolvePolicy = jest.fn().mockResolvedValue({
        triggerMode: 'BATCH',
        waitForMatching: true,
        waitForEvidence: false,
        waitForScans: false,
        minIntervalMinutes: 0,
        maxStalenessHours: 0,
      });
      const runAgent = jest.fn().mockResolvedValue(undefined);
      (worker as any).runAgent = runAgent;

      await (worker as any).runCycle({
        sourceId: null,
        runnerId: null,
        corpus: true,
        cycleKey: 'corpus:x',
        trigger: 'corpus',
        manual: false,
        instruction: null,
      });

      expect(runAgent).not.toHaveBeenCalled();
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

/**
 * The heartbeat, and why it has to exist.
 *
 * A completed scan is otherwise the only thing that enqueues a cycle, so the
 * per-agent policy is only ever consulted while the corpus is being scanned.
 * That makes the staleness backstop — advertised as the liveness guarantee for
 * a gated agent — unreachable on a corpus that has gone quiet: it is evaluated
 * inside a cycle, and there are no cycles.
 *
 * The absurdity worth naming is that this bites the SETTLED agents hardest.
 * They are told to wait for a quiet corpus, and a quiet corpus is exactly the
 * state in which nothing was left to wake them.
 */
describe('AutopilotWorker heartbeat', () => {
  const build = (over: {
    dirty?: Array<{ id: string; name: string; autopilotDirtyAt: Date }>;
    lastTriggered?: Date | null;
    maxStalenessHours?: number;
  }) => {
    const runAgent = jest.fn().mockResolvedValue(undefined);
    const worker = new AutopilotWorker(
      {
        instanceSettings: {
          findUnique: jest.fn().mockResolvedValue({
            harnessAiProviderConfigId: 'p1',
            autopilotInquiryEnabled: true,
            autopilotCaseEnabled: false,
            autopilotConfigEnabled: false,
            autopilotDetectorEnabled: false,
            autopilotEscalationEnabled: false,
            harnessCycleBudgetMinutes: 30,
            harnessEvidenceWarnCoverage: 0.8,
            harnessEvidenceUsableFindings: 2000,
            harnessEvidenceUsableCoverage: 0.25,
          }),
        },
        source: {
          findMany: jest.fn().mockResolvedValue(over.dirty ?? []),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        runner: { count: jest.fn().mockResolvedValue(0) },
      } as never,
      {
        getBossAsync: jest.fn().mockResolvedValue({
          getQueueStats: jest.fn().mockResolvedValue({
            queuedCount: 0,
            activeCount: 0,
            deferredCount: 0,
          }),
        }),
      } as never,
      { recordSkippedRun: jest.fn() } as never,
      {} as never,
      {
        sourceName: jest.fn().mockResolvedValue('a source'),
        evidenceCoverage: jest.fn().mockResolvedValue({ open: 0, analyzed: 0 }),
        unmonitoredFindings: jest.fn().mockResolvedValue({ total: 0 }),
        detectionYield: jest.fn().mockResolvedValue({ blind: false }),
      } as never,
      {} as never,
      { status: jest.fn().mockResolvedValue({ pendingEmbedJobs: 0 }) } as never,
      {
        resolvePolicy: jest.fn().mockResolvedValue({
          triggerMode: 'SETTLED',
          waitForMatching: false,
          waitForEvidence: false,
          waitForScans: false,
          minIntervalMinutes: 0,
          maxStalenessHours: over.maxStalenessHours ?? 24,
        }),
        lastTriggeredAt: jest
          .fn()
          .mockResolvedValue(
            over.lastTriggered === undefined ? null : over.lastTriggered,
          ),
        markTriggered: jest.fn().mockResolvedValue(undefined),
        runBudgetMinutes: jest.fn().mockResolvedValue(null),
      } as never,
    );
    (worker as unknown as { runAgent: unknown }).runAgent = runAgent;
    return { worker, runAgent };
  };

  const beat = (worker: AutopilotWorker, heartbeat = true) =>
    (
      worker as unknown as {
        runCycle: (c: Record<string, unknown>) => Promise<void>;
      }
    ).runCycle({
      sourceId: null,
      runnerId: null,
      corpus: true,
      heartbeat,
      cycleKey: 'corpus:beat',
      trigger: 'heartbeat',
      manual: false,
      instruction: null,
    });

  it('runs an agent past its backstop even though no scan has happened', async () => {
    // The whole point: no dirty sources, nothing to react to, and the agent
    // still has to run because it has been too long since anyone looked.
    const h = build({ dirty: [], lastTriggered: null });

    await beat(h.worker);

    expect(h.runAgent).toHaveBeenCalled();
  });

  it('does nothing when no agent is overdue', async () => {
    // A quiet instance must stay quiet. A heartbeat that ran the pipeline every
    // tick would be a second cadence, which is what this design removes.
    const h = build({
      dirty: [],
      lastTriggered: new Date(Date.now() - 60_000),
    });

    await beat(h.worker);

    expect(h.runAgent).not.toHaveBeenCalled();
  });

  it('respects a disabled backstop rather than running anyway', async () => {
    const h = build({
      dirty: [],
      lastTriggered: null,
      maxStalenessHours: 0,
    });

    await beat(h.worker);

    expect(h.runAgent).not.toHaveBeenCalled();
  });

  it('leaves the ordinary empty-batch cycle short-circuiting as before', async () => {
    // Only a heartbeat may bypass the empty-batch return; a scan-triggered
    // corpus job that outlived its batch must still do nothing.
    const h = build({ dirty: [], lastTriggered: null });

    await beat(h.worker, false);

    expect(h.runAgent).not.toHaveBeenCalled();
  });

  it('picks up sources a previous cycle deferred and left dirty', async () => {
    // The second stranding case: agents deferred, their sources kept dirty for
    // "the next cycle", and no next cycle ever arrived because scanning stopped.
    const h = build({
      dirty: [
        {
          id: 's1',
          name: 'A',
          autopilotDirtyAt: new Date('2026-08-17T10:00:00Z'),
        },
      ],
      lastTriggered: new Date(),
    });

    await beat(h.worker);

    expect(h.runAgent).toHaveBeenCalled();
  });
});
