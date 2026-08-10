import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { AgentKind, AgentRunStatus, InstanceSettings } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { AiSchemaError } from '../ai';
import { INQUIRY_MATCH_QUEUE } from '../matching/matching.constants';
import { EmbeddingQueueService } from '../embedding/embedding-queue.service';
import { AgentAuditService } from './audit/agent-audit.service';
import { AgentLoggerService } from './audit/agent-logger.service';
import { AgentSearchService } from './search/agent-search.service';
import { HarnessService } from './harness/harness.service';
import { AgentRunCancelledError } from './agent-runtime';
import type { ApplySummary } from './decision-applier.service';
import {
  AGENT_RUN_STALE_AFTER_MS,
  AUTOPILOT_COALESCE_WINDOW_SECONDS,
  AUTOPILOT_CORPUS_SINGLETON_KEY,
  AUTOPILOT_CYCLE_BUDGET_MS,
  AUTOPILOT_DREAM_CRON,
  AUTOPILOT_MAX_READINESS_REQUEUES,
  AUTOPILOT_QUEUE,
  AUTOPILOT_RETRY_AFTER_SECONDS,
  DETECTION_CHAIN,
  EVIDENCE_ANALYSIS_MIN_COVERAGE,
  EVIDENCE_ANALYSIS_USABLE_COVERAGE,
  EVIDENCE_ANALYSIS_USABLE_FINDINGS,
  INVESTIGATION_CHAIN,
  PIPELINE_KINDS,
} from './autopilot.constants';
import type { AgentContext, AutopilotJob } from './autopilot.types';

const INSTANCE_SETTINGS_ID = 1;

/**
 * Agents that record a SKIPPED run when their switch is off.
 *
 * Only the two investigation agents do. The other three are opt-in and off by
 * default, so a SKIPPED row per scan for each would bury the audit trail.
 */
const DISABLED_SKIP_REASONS: Partial<Record<AgentKind, string>> = {
  [AgentKind.INQUIRY]:
    'Inquiry autopilot disabled in settings; observing only.',
  [AgentKind.CASE]: 'Case autopilot disabled in settings; observing only.',
};

interface CycleInput {
  sourceId: string | null;
  runnerId: string | null;
  cycleKey: string;
  trigger: string;
  manual: boolean;
  instruction: string | null;
  /** Run exactly these pipeline agents (in canonical order), bypassing enable-flags. */
  only?: AgentKind[] | null;
  /** Case-focused run: the case agent works on exactly this case. */
  caseId?: string | null;
  /** Coalesced batch: every source scanned since the last corpus cycle. */
  corpus?: boolean;
  /** Why this cycle skipped the coalescing window, if it did. */
  expressReason?: string | null;
  /** Requeue count for the readiness gate; bounded so it cannot spin forever. */
  readinessAttempts?: number;
}

/** What this particular cycle turned out to be looking at, resolved at run time. */
interface CycleScope {
  batchSources?: Array<{ id: string; name: string }>;
  evidenceAnalysisPending?: boolean;
  evidenceCoverage?: { open: number; analyzed: number };
  unmonitoredFindings?: number;
  detectionBlind?: boolean;
}

interface DirtySource {
  id: string;
  name: string;
  autopilotDirtyAt: Date;
}

/**
 * Consumes AUTOPILOT_QUEUE jobs and orchestrates one autopilot cycle:
 * inquiry agent first, then case agent — each with its own resumable
 * AgentRun, full BUSINESS/TECHNICAL logging and decision audit.
 *
 * Two job shapes:
 *  - scan_completed (enqueued by cli-runner with a debounce delay)
 *  - manual "steer" runs (POST /autopilot/trigger): reviews ALL existing
 *    open data with an operator instruction, both agents treated as enabled.
 */
@Injectable()
export class AutopilotWorker {
  private readonly logger = new Logger(AutopilotWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
    private readonly audit: AgentAuditService,
    private readonly log: AgentLoggerService,
    private readonly search: AgentSearchService,
    private readonly harness: HarnessService,
    private readonly embeddings: EmbeddingQueueService,
  ) {}

  /**
   * Registers this worker on the CURRENT namespace's pg-boss (invoked by the
   * NamespaceWorkerManager inside the namespace's CLS context).
   */
  async registerForNamespace(): Promise<void> {
    await this.reapStaleRuns();
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(AUTOPILOT_QUEUE);
    await this.pgBoss.work(AUTOPILOT_QUEUE, { localConcurrency: 1 }, (jobs) =>
      this.handle(jobs as Job[]),
    );
    // Every-other-day "dreaming": memory consolidation on a pg-boss schedule.
    try {
      await boss.schedule(
        AUTOPILOT_QUEUE,
        AUTOPILOT_DREAM_CRON,
        { dream: true },
        { tz: 'UTC' },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to register dream schedule: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.logger.log(`Registered worker for queue ${AUTOPILOT_QUEUE}`);
  }

  /**
   * Fail agent runs left RUNNING far past any plausible duration.
   *
   * A run wedged on an unresponsive provider keeps its status forever: nothing
   * finalises it, so the UI shows a permanently "active" run and
   * `openRun` will not reuse the cycle key. The DUPLICATES worker has recovered
   * its own stale runs on startup for a while; the LLM-driven kinds need it
   * more, because they are the ones that can hang for hours on a network call.
   *
   * Time-based rather than "everything RUNNING at boot": a worker registering
   * for a second namespace must not fail a run that is legitimately in flight
   * for the first one.
   */
  private async reapStaleRuns(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - AGENT_RUN_STALE_AFTER_MS);
      const result = await this.prisma.agentRun.updateMany({
        where: {
          status: AgentRunStatus.RUNNING,
          startedAt: { lt: cutoff },
        },
        data: {
          status: AgentRunStatus.FAILED,
          error:
            'Run exceeded its maximum lifetime without finishing (provider or tool never responded).',
          finishedAt: new Date(),
        },
      });
      if (result.count > 0) {
        this.logger.warn(
          `Reaped ${result.count} stale agent run(s) that were still RUNNING past the maximum lifetime.`,
        );
      }
    } catch (error) {
      // Never block worker registration on cleanup.
      this.logger.warn(
        `Failed to reap stale agent runs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handle(jobs: Job[]): Promise<void> {
    for (const job of jobs) {
      const data = job.data as Partial<AutopilotJob>;
      const sourceId =
        typeof data?.sourceId === 'string' ? data.sourceId : null;
      const runnerId =
        typeof data?.runnerId === 'string' ? data.runnerId : null;
      const manual = data?.manual === true;
      const instruction =
        typeof data?.instruction === 'string' && data.instruction.trim()
          ? data.instruction.trim()
          : null;
      if (data?.dream === true) {
        await this.runDreamCycle({
          cycleKey:
            typeof data?.cycleKey === 'string' && data.cycleKey
              ? data.cycleKey
              : `dream:${new Date().toISOString().slice(0, 10)}`,
          trigger: manual ? 'manual' : 'schedule',
          instruction,
        });
        continue;
      }
      // Run exactly the requested pipeline agents (in canonical order).
      const requested = (
        Array.isArray(data?.agentKinds) ? data.agentKinds : []
      ).filter((k) => typeof k === 'string' && k in AgentKind);
      const only: AgentKind[] | null = requested.length > 0 ? requested : null;
      const corpus = data?.corpus === true;
      if (!sourceId && !manual && !only && !corpus) continue;
      // Per-namespace pg-boss (schema pgboss_<slug>) guarantees a job can only
      // be dequeued by its own namespace's worker, so the previous
      // cross-namespace source/runner existence guard is no longer needed.
      const expressReason =
        typeof data?.expressReason === 'string' ? data.expressReason : null;
      await this.runCycle({
        sourceId,
        runnerId,
        manual,
        only,
        corpus,
        expressReason,
        readinessAttempts:
          typeof data?.readinessAttempts === 'number'
            ? data.readinessAttempts
            : 0,
        caseId: typeof data?.caseId === 'string' ? data.caseId : null,
        instruction,
        cycleKey:
          typeof data?.cycleKey === 'string' && data.cycleKey
            ? data.cycleKey
            : `scan:${sourceId}:${runnerId ?? 'none'}`,
        trigger: manual
          ? 'manual'
          : expressReason
            ? 'express'
            : corpus
              ? 'corpus'
              : 'scan_completed',
      });
    }
  }

  /** Scheduled or manually requested dream (memory consolidation) cycle. */
  private async runDreamCycle(input: {
    cycleKey: string;
    trigger: string;
    instruction?: string | null;
  }): Promise<void> {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
    });
    if (!settings?.aiEnabled) {
      this.logger.debug('AI disabled — skipping dream cycle');
      return;
    }
    await this.runAgent(
      AgentKind.DREAM,
      settings,
      {
        sourceId: null,
        runnerId: null,
        cycleKey: input.cycleKey,
        trigger: input.trigger,
        manual: input.trigger === 'manual',
        instruction: input.instruction ?? null,
      },
      'agent memory',
    );
  }

  async runCycle(cycle: CycleInput): Promise<void> {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
    });
    if (!settings?.aiEnabled) {
      this.logger.debug('AI disabled — skipping autopilot cycle');
      return;
    }
    // Scan cycles respect the instance flags as master switches. Only a manual
    // run is explicit operator intent and may override them (per-entity
    // OBSERVE_ONLY is still enforced by the decision applier).
    //
    // `cycle.only` used to bypass this too, on the reading that a targeted run
    // is deliberate. It is not: rerunRun re-enqueues a *scan*-triggered run
    // with agentKinds set and manual unset, so a queued cycle member kept
    // executing after its agent had been disabled — which is why disabling the
    // agents did not stop the cycle and each member had to be cancelled by hand.
    //
    // Decided with the same per-agent rule used below, so the gate cannot
    // disagree with what it gates. It used to test only the inquiry and case
    // flags, which meant enabling *just* the escalation agent skipped the whole
    // cycle and that agent never ran.
    const enabledAgents = await Promise.all(
      PIPELINE_KINDS.map((kind) => this.agentEnabled(kind, cycle)),
    );
    if (!enabledAgents.some(Boolean)) {
      this.logger.debug(
        `Autopilot disabled — skipping cycle for source ${cycle.sourceId}`,
      );
      return;
    }

    // Deterministic ordering for scan cycles: if the work the agents reason
    // FROM is still in flight, push the cycle back rather than race it.
    //
    // This used to wait on inquiry matching alone, so the TRIAGE DOCTRINE
    // ("start from findings.ranked, read the importance reasons") was routinely
    // applied to findings that had no importance score yet — every one of them
    // reading as score 0, indistinguishable from genuinely unimportant.
    const attempts = cycle.readinessAttempts ?? 0;
    const blocked = cycle.manual ? null : await this.readinessBlocked();
    if (blocked && attempts < AUTOPILOT_MAX_READINESS_REQUEUES) {
      this.logger.log(
        `${blocked} still pending — re-queueing autopilot cycle (attempt ${attempts + 1}) for ${cycle.corpus ? 'corpus' : `source ${cycle.sourceId}`}`,
      );
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(
        AUTOPILOT_QUEUE,
        {
          sourceId: cycle.sourceId ?? undefined,
          runnerId: cycle.runnerId ?? undefined,
          corpus: cycle.corpus,
          expressReason: cycle.expressReason ?? undefined,
          agentKinds: cycle.only ?? undefined,
          caseId: cycle.caseId ?? undefined,
          instruction: cycle.instruction ?? undefined,
          cycleKey: cycle.cycleKey,
          readinessAttempts: attempts + 1,
        },
        {
          startAfter: AUTOPILOT_RETRY_AFTER_SECONDS,
          singletonKey: cycle.corpus
            ? AUTOPILOT_CORPUS_SINGLETON_KEY
            : `autopilot:${cycle.sourceId}`,
          // `singletonKey` alone dedupes NOTHING on this queue: in pg-boss 12
          // every single-job-per-key index is predicated on the queue policy,
          // and this queue is `standard`. Without a slot width each requeue
          // therefore inserted a brand-new job, and with a fresh corpus cycle
          // arriving every window each one started its own chain counting to
          // five. Measured on a live 151-source namespace: 29 completed cycle
          // jobs spread across attempts 1..5, and exactly one of them ever
          // reached the agents — the rest found the dirty set already claimed
          // and exited. Same slot width as the coalescing window, so a retry
          // and a fresh cycle landing together become one job rather than two.
          singletonSeconds: AUTOPILOT_COALESCE_WINDOW_SECONDS,
          // Deliberately NOT `singletonNextSlot` here, unlike the enqueue path
          // in CorrelationWorker. There, a collision means the slot's job has
          // already RUN, so dropping the insert would strand the sources that
          // scan marked dirty — it has to move to the next slot. Here, a
          // collision means a corpus cycle is already QUEUED, and it reads the
          // same shared dirty set when it runs, so nothing is stranded by
          // letting this retry go.
          //
          // Deferring instead cost throughput: each collision pushed a retry
          // into the following slot rather than merging it, and a live
          // 151-source namespace accumulated 55 queued cycles across attempts
          // 2..5 while investigation had not run for three hours.
          expireInSeconds: 3 * 3600,
        },
      );
      return;
    }
    // Measured, not inferred from queue state. This used to be
    // `blocked != null` — "the queue was busy when we looked" — which on a
    // busy instance was true on every cycle and put the "scores are partial,
    // prefer deferring" warning in front of the agents permanently, including
    // when every finding in scope was in fact scored. What the missions need to
    // know is whether the findings they are about to triage have importance
    // scores, and that is a question about the data.
    // Carry the actual numbers, not just a flag. "Scores are partial" reads
    // very differently at 700/749 than at 1/749, and the missions were told the
    // mild version while `findings.ranked` was returning essentially nothing —
    // so they stood down every cycle citing "ranking unavailable".
    const evidenceCoverage = await this.evidenceCoverageSafe();
    const evidenceAnalysisPending =
      evidenceCoverage.open > 0 &&
      evidenceCoverage.analyzed / evidenceCoverage.open <
        EVIDENCE_ANALYSIS_MIN_COVERAGE;
    if (blocked) {
      this.logger.warn(
        `Proceeding with autopilot cycle after ${attempts} readiness requeue(s); ${blocked} is still pending.`,
      );
    }

    // A corpus cycle reads the dirty set without acknowledging it. The exact
    // timestamps are cleared only after every enabled agent finishes, giving
    // the job at-least-once delivery: a provider failure leaves the batch for
    // pg-boss's retry, and a newer scan timestamp cannot be erased by this run.
    const dirtySources = cycle.corpus ? await this.readDirtySources() : [];
    const batchSources = dirtySources.map(({ id, name }) => ({ id, name }));
    // Nothing new since the last batch. A readiness requeue always inserts (it
    // must, or a deferred cycle would be lost), so a corpus job can outlive the
    // batch it was queued for — and running five agents over "all sources" to
    // rediscover nothing is precisely the churn this cadence exists to remove.
    if (cycle.corpus && batchSources.length === 0 && !cycle.manual) {
      this.logger.debug(
        'Corpus cycle skipped: no sources have been scanned since the last one.',
      );
      return;
    }

    const sourceName = cycle.sourceId
      ? await this.search.sourceName(cycle.sourceId)
      : cycle.corpus && batchSources.length > 0
        ? `${batchSources.length} newly scanned source(s)`
        : 'all sources';

    const scope: CycleScope = {
      batchSources: cycle.corpus ? batchSources : undefined,
      evidenceAnalysisPending,
      evidenceCoverage,
      unmonitoredFindings: await this.unmonitoredCount(),
      detectionBlind: await this.detectionBlind(),
    };

    // Two chains, run concurrently, each ordered internally by a real
    // dependency. Running all five in series cost the harness an order of
    // magnitude in throughput for ordering that mostly was not load-bearing:
    // CONFIG's "reacts to the finding landscape the investigation agents
    // observed" is a read of the database, not of their output, and the
    // landscape it reads is whatever the last scan produced either way.
    //
    // What IS load-bearing is kept: CASE consumes the inquiries INQUIRY just
    // created or widened, ESCALATION alerts on the final state of the cases
    // CASE mutated, and DETECTOR_AUTHOR reacts to what CONFIG left unaddressed
    // (they also write the same source config, so serialising them keeps them
    // off each other's optimistic-concurrency token).
    const deadline = Date.now() + AUTOPILOT_CYCLE_BUDGET_MS;
    await Promise.all([
      this.runChain(
        INVESTIGATION_CHAIN,
        settings,
        cycle,
        sourceName,
        scope,
        deadline,
      ),
      this.runChain(
        DETECTION_CHAIN,
        settings,
        cycle,
        sourceName,
        scope,
        deadline,
      ),
    ]);

    if (cycle.corpus) {
      await this.acknowledgeDirtySources(dirtySources);
    }
  }

  /**
   * Run one dependency chain in order, stopping at the cycle deadline.
   *
   * An explicit agent set ("only") is operator intent: run exactly those
   * pipeline agents and skip the rest without a SKIPPED record.
   */
  private async runChain(
    chain: readonly AgentKind[],
    settings: InstanceSettings,
    cycle: CycleInput,
    sourceName: string,
    scope: CycleScope,
    deadline: number,
  ): Promise<void> {
    for (const kind of chain) {
      if (Date.now() >= deadline) {
        // Deliberately not a SKIPPED audit row: the agent was not disabled,
        // the cycle simply ran out of wall clock. The next cycle runs it with
        // fresher data.
        this.logger.warn(
          `Autopilot cycle budget exhausted — skipping ${kind} and the rest of ` +
            `its chain for ${cycle.corpus ? 'corpus' : `source ${cycle.sourceId}`}.`,
        );
        return;
      }

      if (await this.agentEnabled(kind, cycle)) {
        await this.runAgent(kind, settings, cycle, sourceName, scope);
        continue;
      }

      // Only the two investigation agents record a SKIPPED run; the opt-in
      // agents are off by default, and a SKIPPED row per scan for each of them
      // is pure noise.
      const skipReason = DISABLED_SKIP_REASONS[kind];
      if (!cycle.only && skipReason) {
        await this.audit.recordSkippedRun(
          kind,
          cycle.sourceId ?? 'all',
          cycle.runnerId,
          skipReason,
        );
      }
    }
  }

  /**
   * Whether an agent may run, decided against the *current* settings.
   *
   * Re-read per agent rather than once per cycle. A cycle runs five agents
   * sequentially over many minutes, and the flags used to be captured once at
   * the top — so an operator disabling an agent mid-cycle watched it start
   * anyway, and had to cancel each member by hand as it launched.
   *
   * `cycle.only` narrows which agents run; it does not authorise them. It used
   * to replace the flag check outright, which meant any job carrying agentKinds
   * ran every named agent regardless of the switches — including reruns of
   * scan-triggered runs, which set agentKinds but not `manual`.
   */
  private async agentEnabled(
    kind: AgentKind,
    cycle: CycleInput,
  ): Promise<boolean> {
    if (cycle.only && !cycle.only.includes(kind)) return false;

    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
    });
    if (!settings?.aiEnabled) return false;

    // Explicit operator intent overrides the master switches; the decision
    // applier still enforces per-entity OBSERVE_ONLY.
    if (cycle.manual) return true;

    switch (kind) {
      case AgentKind.INQUIRY:
        return settings.autopilotInquiryEnabled;
      case AgentKind.CASE:
        return settings.autopilotCaseEnabled;
      case AgentKind.CONFIG:
        return settings.autopilotConfigEnabled;
      case AgentKind.DETECTOR_AUTHOR:
        return settings.autopilotDetectorEnabled;
      case AgentKind.ESCALATION:
        return settings.autopilotEscalationEnabled;
      default:
        return false;
    }
  }

  private async runAgent(
    agentKind: AgentKind,
    settings: InstanceSettings,
    cycle: CycleInput,
    sourceName: string,
    scope: CycleScope = {},
  ): Promise<void> {
    const run = await this.audit.openRun(agentKind, {
      sourceId: cycle.sourceId,
      runnerId: cycle.runnerId,
      cycleKey: cycle.cycleKey,
      trigger: cycle.trigger,
      instruction: cycle.instruction,
      caseId: agentKind === AgentKind.CASE ? (cycle.caseId ?? null) : null,
    });
    if (run.status !== AgentRunStatus.RUNNING) return;

    await this.log.business(
      run.id,
      agentKind === AgentKind.DREAM
        ? `Dream cycle started: consolidating agent memory (${cycle.trigger}).`
        : cycle.manual
          ? `Manual ${agentKind.toLowerCase()} review started for ${sourceName}${cycle.instruction ? ' with operator instruction.' : '.'}`
          : `${agentKind.charAt(0)}${agentKind.slice(1).toLowerCase()} cycle started after a scan of ${sourceName}.`,
      cycle.instruction ? { instruction: cycle.instruction } : undefined,
    );

    // Only manual runs override the instance flags (explicit operator intent);
    // the applier still enforces per-entity OBSERVE_ONLY. A targeted rerun is
    // not on its own operator intent — see the master-switch check above.
    const effectiveSettings: InstanceSettings = cycle.manual
      ? {
          ...settings,
          autopilotInquiryEnabled: true,
          autopilotCaseEnabled: true,
          autopilotConfigEnabled: true,
          autopilotDetectorEnabled: true,
          autopilotEscalationEnabled: true,
        }
      : settings;

    const ctx: AgentContext = {
      run,
      settings: effectiveSettings,
      sourceId: cycle.sourceId,
      sourceName,
      runnerId: cycle.runnerId,
      manual: cycle.manual,
      instruction: cycle.instruction,
      caseId: agentKind === AgentKind.CASE ? (cycle.caseId ?? null) : null,
      batchSources: scope.batchSources,
      expressReason: cycle.expressReason ?? null,
      evidenceAnalysisPending: scope.evidenceAnalysisPending,
      evidenceCoverage: scope.evidenceCoverage,
      unmonitoredFindings: scope.unmonitoredFindings,
      detectionBlind: scope.detectionBlind,
      state: {},
    };
    try {
      const summary = await this.harness.execute(ctx);
      await this.audit.complete(run.id, formatSummary(summary));
      await this.log.business(
        run.id,
        `Cycle finished: ${formatSummary(summary)}`,
      );
      this.logger.log(
        `${agentKind} agent run ${run.id} completed: ${formatSummary(summary)}`,
      );
    } catch (error) {
      if (error instanceof AgentRunCancelledError) {
        // Operator stop request — the run is already CANCELLED; just close
        // the narrative and let the job complete normally (no retry).
        this.logger.log(`${agentKind} agent run ${run.id} cancelled`);
        return;
      }
      if (error instanceof AiSchemaError) {
        // The model could not produce valid output even after completeJson's
        // correction retries — store every raw response so the operator can
        // inspect exactly what came back, then stop (a retry with identical
        // context is unlikely to do better).
        await this.log.error(
          run.id,
          'TECHNICAL',
          'Model failed to produce schema-valid output.',
          {
            attempts: error.attempts.map((a, i) => ({
              attempt: i + 1,
              error: a.error,
              raw: a.raw,
            })),
          },
        );
        await this.audit.recordDecision(run.id, {
          action: 'NO_ACTION',
          outcome: 'FAILED',
          rationale: `Model failed to produce schema-valid output: ${error.message}`,
          dedupeKey: 'schema-error',
        });
        await this.audit.fail(run.id, error);
        this.logger.warn(
          `${agentKind} agent run ${run.id} failed on schema: ${error.message}`,
        );
        return;
      }
      // Provider/transient errors: mark failed and rethrow so pg-boss retries;
      // the run resumes from its last completed step.
      await this.log.error(
        run.id,
        'TECHNICAL',
        'Cycle failed with a provider/transient error.',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      await this.audit.fail(run.id, error);
      this.logger.error(
        `${agentKind} agent run ${run.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Surface when this kind is failing far more than its siblings — the
      // signal that the failure is agent-specific (e.g. model/routing scoped to
      // one kind) rather than a provider-wide outage. Advisory; never blocks.
      await this.warnOnKindFailureDivergence(agentKind, run.id);
      throw error;
    }
  }

  /**
   * Emit a loud, queryable warning when one agent kind's recent failure rate
   * diverges from its siblings — e.g. CASE runs failing on "model not found"
   * while every other kind succeeds on the same provider. Best-effort: a
   * failure to compute the signal must never mask the original run failure.
   */
  private async warnOnKindFailureDivergence(
    kind: AgentKind,
    runId: string,
  ): Promise<void> {
    try {
      const d = await this.audit.checkKindFailureDivergence(kind);
      if (!d) return;
      const pct = (n: number): string => `${Math.round(n * 100)}%`;
      await this.log.error(
        runId,
        'TECHNICAL',
        `Agent-kind failure divergence: ${kind} is failing ${pct(d.kindFailureRate)} ` +
          `of recent runs vs ${pct(d.siblingFailureRate)} for other kinds — likely ` +
          `an issue scoped to ${kind}, not a provider-wide outage.`,
        {
          kind,
          kindFailureRate: d.kindFailureRate,
          siblingFailureRate: d.siblingFailureRate,
          kindRuns: d.kindRuns,
          siblingRuns: d.siblingRuns,
        },
      );
      this.logger.warn(
        `Agent-kind failure divergence: ${kind} ${pct(d.kindFailureRate)} vs siblings ${pct(d.siblingFailureRate)}`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to compute agent-kind failure divergence for ${kind}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Name of the pipeline the cycle is still waiting on, or null when ready.
   *
   * Inquiry matching decides which inquiries have new matches; evidence
   * analysis decides which findings are important. The agents' whole triage
   * doctrine is built on the second, and it was never waited for — an
   * unanalyzed finding scores 0, exactly like a genuinely unimportant one, so
   * running early does not merely lose signal, it inverts it.
   */
  /**
   * Whether the work the agents reason FROM is too raw to reason from yet.
   *
   * Both checks used to be "is this queue non-empty" — which under continuous
   * ingestion is permanently true, so the gate deferred forever. On a live
   * 151-source namespace evidence analysis sat at 38% while scans kept
   * arriving, and the harness ran one investigation cycle in two hours.
   *
   * The queue being busy is not the question. The question is whether the
   * agents have enough scored evidence to reason from — and that is answered
   * primarily by how much there IS, not by what fraction of the corpus it
   * happens to be.
   *
   * A ratio alone was the second version of this bug. Its denominator grows, so
   * where ingestion outpaces analysis the ratio falls and the gate re-engages
   * exactly when the corpus is largest: 442,613 scored findings against
   * 1,914,477 open read as "23%, not ready" while being far more material than
   * a cycle could ever consume. The absolute floor is the real test; the ratio
   * survives only for corpora too small for it to apply, where a few hundred
   * scored findings genuinely may be too thin to rank.
   */
  private async readinessBlocked(): Promise<string | null> {
    if (await this.queueBusy(INQUIRY_MATCH_QUEUE)) return 'Inquiry matching';
    if (!(await this.evidenceAnalysisBusy())) return null;

    const coverage = await this.evidenceCoverageSafe();
    // Nothing scored and nothing to score: an instance with no semantic stack
    // still needs its agents.
    if (coverage.open === 0) return null;
    if (coverage.analyzed >= EVIDENCE_ANALYSIS_USABLE_FINDINGS) return null;
    const ratio = coverage.analyzed / coverage.open;
    if (ratio >= EVIDENCE_ANALYSIS_USABLE_COVERAGE) return null;
    return (
      `Evidence analysis (only ${coverage.analyzed} of ${coverage.open} findings ` +
      `scored — under both the ${EVIDENCE_ANALYSIS_USABLE_FINDINGS}-finding floor ` +
      `and the ${Math.round(EVIDENCE_ANALYSIS_USABLE_COVERAGE * 100)}% fallback)`
    );
  }

  /**
   * Whether enough OPEN findings still lack an importance score that the
   * missions should be told their triage order is partial.
   *
   * Deliberately a data question with an explicit threshold rather than
   * "is anything queued". A handful of unscored findings among thousands does
   * not make findings.ranked untrustworthy, and warning about it anyway trained
   * the agents to discount the one tool their triage doctrine is built on.
   */
  /**
   * How many high-importance findings no inquiry is watching.
   *
   * Surfaced on every cycle rather than left to the agent to go and ask,
   * because it never did: with only "avoid duplicates / prefer enriching /
   * wind down noise" in front of it, re-reading the inquiries that already
   * existed was the rational move, and 250 high-importance findings sat
   * unwatched behind a single matching inquiry.
   */
  private async unmonitoredCount(): Promise<number | undefined> {
    try {
      return (await this.search.unmonitoredFindings()).total;
    } catch {
      // Advisory only — never fail a cycle over it.
      return undefined;
    }
  }

  /**
   * Whether recent scans read assets and detected nothing at all.
   *
   * Every config decision is a reduction, and each one alone is defensible, so
   * on a live instance the ratchet ran to its end: all five built-in detectors
   * disabled over two days, then a full sweep of the corpus every three hours
   * producing zero findings and nothing for any other agent to work with. This
   * is the counter-pressure that was missing.
   */
  private async detectionBlind(): Promise<boolean | undefined> {
    try {
      return (await this.search.detectionYield()).blind;
    } catch {
      // Advisory only — never fail a cycle over it.
      return undefined;
    }
  }

  /** Open/scored finding counts; never fails a cycle because a count failed. */
  private async evidenceCoverageSafe(): Promise<{
    open: number;
    analyzed: number;
  }> {
    try {
      return await this.search.evidenceCoverage();
    } catch {
      return { open: 0, analyzed: 0 };
    }
  }

  private async queueBusy(queue: string): Promise<boolean> {
    try {
      const boss = await this.pgBoss.getBossAsync();
      const stats = await boss.getQueueStats(queue);
      return stats.queuedCount + stats.activeCount + stats.deferredCount > 0;
    } catch {
      // A queue that has never been created has no stats. Treating that as
      // "busy" would stall every cycle on a fresh instance.
      return false;
    }
  }

  /**
   * Embedding INFERENCE feeds FindingEvidenceAnalysis, which is what
   * findings.ranked and findings.explain read. Only inference is waited for.
   *
   * `recalibrationScheduled` used to count too, on the reasoning that scores
   * are corpus-relative only once the pass has run. In practice that made the
   * gate permanently closed during any sustained ingest:
   * `handleRecalibration` re-defers itself by RECALIBRATE_DELAY_SECONDS
   * whenever inference is still draining, so with scans landing continuously
   * the recalibrate queue is never empty. Every cycle therefore burned all five
   * readiness requeues — five minutes of pure delay — and then ran with
   * `evidenceAnalysisPending` set, which tells the missions to "treat
   * findings.ranked as partial and prefer deferring to concluding". A cadence
   * change meant to make the agents better-informed instead made every cycle
   * during an ingest both slower and more timid.
   *
   * Recalibration reorders existing scores; it does not create them. Running a
   * cycle against scores that are accurate but not yet re-normalised is a far
   * smaller error than never running a useful cycle at all.
   */
  private async evidenceAnalysisBusy(): Promise<boolean> {
    try {
      const status = await this.embeddings.status();
      return (status.pendingEmbedJobs ?? 0) > 0;
    } catch {
      // Embeddings unconfigured or not ready is not a reason to hold the
      // cycle: an instance with no semantic stack still needs its agents.
      return false;
    }
  }

  /** Snapshot the pending batch without acknowledging it. */
  private async readDirtySources(): Promise<DirtySource[]> {
    const rows = await this.prisma.source.findMany({
      where: { autopilotDirtyAt: { not: null } },
      select: { id: true, name: true, autopilotDirtyAt: true },
      orderBy: { autopilotDirtyAt: 'asc' },
    });
    // Prisma does not narrow nullable fields from a `not: null` filter in the
    // generated TypeScript type. Keep the runtime boundary honest as well.
    return rows.flatMap((source) =>
      source.autopilotDirtyAt
        ? [
            {
              id: source.id,
              name: source.name,
              autopilotDirtyAt: source.autopilotDirtyAt,
            },
          ]
        : [],
    );
  }

  /**
   * Acknowledge only the exact scan timestamps this cycle processed.
   *
   * Each source has one dirty timestamp rather than a queue row. Matching both
   * id and timestamp is therefore the compare-and-set that prevents a scan
   * finishing during this cycle from being cleared with the older batch.
   */
  private async acknowledgeDirtySources(dirty: DirtySource[]): Promise<void> {
    if (dirty.length === 0) return;
    await this.prisma.source.updateMany({
      where: {
        OR: dirty.map((source) => ({
          id: source.id,
          autopilotDirtyAt: source.autopilotDirtyAt,
        })),
      },
      data: { autopilotDirtyAt: null },
    });
  }
}

export function formatSummary(s: ApplySummary): string {
  // A cycle that correctly changed nothing used to read "0 applied; 6 read" —
  // indistinguishable from a wasted run, both to the operator scanning the run
  // list and to the model reading its own history and inferring what a good
  // cycle looks like. Restraint is an outcome; name it as one.
  if (s.applied === 0 && s.failed === 0 && (s.readOk ?? 0) > 0) {
    const why = s.finishSummary?.trim();
    // Only a run that CHOSE to stop can be called restraint. One that hit its
    // iteration budget was cut off mid-investigation and decided nothing —
    // labelling it "nothing warranted a change" reported a truncated run as a
    // considered judgement, and buried the runs most worth looking at. Observed
    // live as: "observed only, nothing warranted a change — Reached the
    // 14-iteration budget without finishing."
    if (s.finishedDeliberately === false) {
      return `ran out of iterations before finishing${why ? ` — ${why}` : ''} (${s.readOk} read, nothing applied)`;
    }
    return `observed only, nothing warranted a change${why ? ` — ${why}` : ''} (${s.readOk} read)`;
  }
  // "applied" counts mutations only. Reads are reported separately rather than
  // inflating it — a run that read 11 things and changed nothing used to say
  // "11 applied" while persisting zero decisions.
  const parts = [
    `${s.applied} applied`,
    `${s.readOk ?? 0} read`,
    `${s.skippedObserveOnly} observe-only`,
    `${s.failed} failed`,
  ];
  if (s.createdInquiries.length > 0) {
    parts.push(
      `created inquiries: ${s.createdInquiries.map((q) => q.title).join(', ')}`,
    );
  }
  if (s.createdCases.length > 0) {
    parts.push(
      `created cases: ${s.createdCases.map((c) => c.title).join(', ')}`,
    );
  }
  return parts.join('; ');
}
