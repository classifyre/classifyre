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
  AUTOPILOT_CORPUS_SINGLETON_KEY,
  AUTOPILOT_DREAM_CRON,
  AUTOPILOT_MAX_READINESS_REQUEUES,
  AUTOPILOT_QUEUE,
  AUTOPILOT_RETRY_AFTER_SECONDS,
  PIPELINE_KINDS,
} from './autopilot.constants';
import type { AgentContext, AutopilotJob } from './autopilot.types';

const INSTANCE_SETTINGS_ID = 1;

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
          cycleKey: cycle.cycleKey,
          readinessAttempts: attempts + 1,
        },
        {
          startAfter: AUTOPILOT_RETRY_AFTER_SECONDS,
          singletonKey: cycle.corpus
            ? AUTOPILOT_CORPUS_SINGLETON_KEY
            : `autopilot:${cycle.sourceId}`,
          expireInSeconds: 3 * 3600,
        },
      );
      return;
    }
    // Bounded: a permanently backed-up embedding queue degrades the run rather
    // than deadlocking the autopilot. The missions are told the scores are
    // partial instead of silently trusting them.
    const evidenceAnalysisPending = blocked != null;
    if (evidenceAnalysisPending) {
      this.logger.warn(
        `Proceeding with autopilot cycle after ${attempts} readiness requeue(s); ${blocked} is still pending.`,
      );
    }

    // A corpus cycle consumes the dirty set: read it, then clear exactly those
    // rows, so sources scanned while this cycle runs enrol in the next batch
    // rather than being silently dropped.
    const batchSources = cycle.corpus ? await this.consumeDirtySources() : [];

    const sourceName = cycle.sourceId
      ? await this.search.sourceName(cycle.sourceId)
      : cycle.corpus && batchSources.length > 0
        ? `${batchSources.length} newly scanned source(s)`
        : 'all sources';

    const scope: CycleScope = {
      batchSources: cycle.corpus ? batchSources : undefined,
      evidenceAnalysisPending,
    };

    // An explicit agent set ("only") is operator intent: run exactly those
    // pipeline agents (in canonical order) and skip the rest without a SKIPPED
    // record.
    if (await this.agentEnabled(AgentKind.INQUIRY, cycle)) {
      await this.runAgent(
        AgentKind.INQUIRY,
        settings,
        cycle,
        sourceName,
        scope,
      );
    } else if (!cycle.only) {
      await this.audit.recordSkippedRun(
        AgentKind.INQUIRY,
        cycle.sourceId ?? 'all',
        cycle.runnerId,
        'Inquiry autopilot disabled in settings; observing only.',
      );
    }

    if (await this.agentEnabled(AgentKind.CASE, cycle)) {
      await this.runAgent(AgentKind.CASE, settings, cycle, sourceName, scope);
    } else if (!cycle.only) {
      await this.audit.recordSkippedRun(
        AgentKind.CASE,
        cycle.sourceId ?? 'all',
        cycle.runnerId,
        'Case autopilot disabled in settings; observing only.',
      );
    }

    // Config-tuning agent — opt-in, off by default. Runs after the
    // investigation agents (it reacts to the finding landscape they observed).
    // Skipped silently when disabled (no SKIPPED-run noise on every scan).
    if (await this.agentEnabled(AgentKind.CONFIG, cycle)) {
      await this.runAgent(AgentKind.CONFIG, settings, cycle, sourceName, scope);
    }

    // Detector-authoring agent — opt-in, off by default. Runs last so it can
    // react to what the config agent left unaddressed.
    if (await this.agentEnabled(AgentKind.DETECTOR_AUTHOR, cycle)) {
      await this.runAgent(
        AgentKind.DETECTOR_AUTHOR,
        settings,
        cycle,
        sourceName,
        scope,
      );
    }

    // Escalation agent — opt-in, off by default. Runs last, once every case
    // mutation for this cycle has settled, so it alerts operators on the final
    // state of the open high-severity cases.
    if (await this.agentEnabled(AgentKind.ESCALATION, cycle)) {
      await this.runAgent(
        AgentKind.ESCALATION,
        settings,
        cycle,
        sourceName,
        scope,
      );
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
  private async readinessBlocked(): Promise<string | null> {
    if (await this.queueBusy(INQUIRY_MATCH_QUEUE)) return 'Inquiry matching';
    if (await this.evidenceAnalysisBusy()) return 'Evidence analysis';
    return null;
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
   * Embedding inference feeds FindingEvidenceAnalysis, which is what
   * findings.ranked and findings.explain read. The recalibration pass is
   * included because scores are only corpus-relative once it has run — the
   * same reason EmbeddingQueueService.handleRecalibration defers itself while
   * inference is draining.
   */
  private async evidenceAnalysisBusy(): Promise<boolean> {
    try {
      const status = await this.embeddings.status();
      return (
        (status.pendingEmbedJobs ?? 0) > 0 || status.recalibrationScheduled
      );
    } catch {
      // Embeddings unconfigured or not ready is not a reason to hold the
      // cycle: an instance with no semantic stack still needs its agents.
      return false;
    }
  }

  /**
   * Read the sources marked dirty by completed scans and clear exactly those
   * rows. Clearing by id rather than with a blanket `WHERE autopilot_dirty_at
   * IS NOT NULL` matters: a scan finishing while this cycle runs must enrol in
   * the NEXT batch, not be silently swallowed by this one.
   */
  private async consumeDirtySources(): Promise<
    Array<{ id: string; name: string }>
  > {
    const dirty = await this.prisma.source.findMany({
      where: { autopilotDirtyAt: { not: null } },
      select: { id: true, name: true },
      orderBy: { autopilotDirtyAt: 'asc' },
    });
    if (dirty.length > 0) {
      await this.prisma.source.updateMany({
        where: { id: { in: dirty.map((s) => s.id) } },
        data: { autopilotDirtyAt: null },
      });
    }
    return dirty;
  }
}

export function formatSummary(s: ApplySummary): string {
  // A cycle that correctly changed nothing used to read "0 applied; 6 read" —
  // indistinguishable from a wasted run, both to the operator scanning the run
  // list and to the model reading its own history and inferring what a good
  // cycle looks like. Restraint is an outcome; name it as one.
  if (s.applied === 0 && s.failed === 0 && (s.readOk ?? 0) > 0) {
    const why = s.finishSummary?.trim();
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
