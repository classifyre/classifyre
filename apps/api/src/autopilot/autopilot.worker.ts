import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { AgentKind, AgentRunStatus, InstanceSettings } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { AiSchemaError } from '../ai';
import { INQUIRY_MATCH_QUEUE } from '../matching/matching.constants';
import { AgentAuditService } from './audit/agent-audit.service';
import { AgentLoggerService } from './audit/agent-logger.service';
import { AgentSearchService } from './search/agent-search.service';
import { HarnessService } from './harness/harness.service';
import { runsBackgroundWorkers } from '../service-role';
import { AgentRunCancelledError } from './agent-runtime';
import type { ApplySummary } from './decision-applier.service';
import {
  AUTOPILOT_DREAM_CRON,
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
export class AutopilotWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutopilotWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
    private readonly audit: AgentAuditService,
    private readonly log: AgentLoggerService,
    private readonly search: AgentSearchService,
    private readonly harness: HarnessService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!runsBackgroundWorkers()) return;
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(AUTOPILOT_QUEUE);
    await boss.work(AUTOPILOT_QUEUE, { localConcurrency: 1 }, (jobs: Job[]) =>
      this.handle(jobs),
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
      if (!sourceId && !manual && !only) continue;
      // Namespace-isolation guard: pg-boss queues can be shared across
      // namespace deployments (and were, before the per-namespace pg-boss
      // schema), so a dequeued job may reference a source/runner from another
      // namespace. Executing it would persist foreign agent runs into this
      // namespace's provenance — drop it loudly instead.
      if (!(await this.jobBelongsToThisNamespace(sourceId, runnerId))) {
        this.logger.warn(
          `Skipping autopilot job for unknown source/runner ` +
            `(sourceId=${sourceId}, runnerId=${runnerId}) — ` +
            `not found in this namespace; likely enqueued by another namespace.`,
        );
        continue;
      }
      await this.runCycle({
        sourceId,
        runnerId,
        manual,
        only,
        caseId: typeof data?.caseId === 'string' ? data.caseId : null,
        instruction,
        cycleKey:
          typeof data?.cycleKey === 'string' && data.cycleKey
            ? data.cycleKey
            : `scan:${sourceId}:${runnerId ?? 'none'}`,
        trigger: manual ? 'manual' : 'scan_completed',
      });
    }
  }

  /**
   * True when the job's source/runner (if any) exist in this deployment's
   * schema. A miss means the job belongs to a different namespace.
   */
  private async jobBelongsToThisNamespace(
    sourceId: string | null,
    runnerId: string | null,
  ): Promise<boolean> {
    if (sourceId) {
      const source = await this.prisma.source.findUnique({
        where: { id: sourceId },
        select: { id: true },
      });
      if (!source) return false;
    }
    if (runnerId) {
      const runner = await this.prisma.runner.findUnique({
        where: { id: runnerId },
        select: { id: true },
      });
      if (!runner) return false;
    }
    return true;
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

    // Deterministic ordering for scan cycles: if inquiry matching is still
    // queued, push the cycle back instead of racing it.
    if (!cycle.manual && (await this.inquiryMatchingPending())) {
      this.logger.log(
        `Inquiry matching still pending — re-queueing autopilot cycle for source ${cycle.sourceId}`,
      );
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(
        AUTOPILOT_QUEUE,
        {
          sourceId: cycle.sourceId ?? undefined,
          runnerId: cycle.runnerId ?? undefined,
          cycleKey: cycle.cycleKey,
        },
        {
          startAfter: AUTOPILOT_RETRY_AFTER_SECONDS,
          singletonKey: `autopilot:${cycle.sourceId}`,
          expireInSeconds: 3 * 3600,
        },
      );
      return;
    }

    const sourceName = cycle.sourceId
      ? await this.search.sourceName(cycle.sourceId)
      : 'all sources';

    // An explicit agent set ("only") is operator intent: run exactly those
    // pipeline agents (in canonical order) and skip the rest without a SKIPPED
    // record.
    if (await this.agentEnabled(AgentKind.INQUIRY, cycle)) {
      await this.runAgent(AgentKind.INQUIRY, settings, cycle, sourceName);
    } else if (!cycle.only) {
      await this.audit.recordSkippedRun(
        AgentKind.INQUIRY,
        cycle.sourceId ?? 'all',
        cycle.runnerId,
        'Inquiry autopilot disabled in settings; observing only.',
      );
    }

    if (await this.agentEnabled(AgentKind.CASE, cycle)) {
      await this.runAgent(AgentKind.CASE, settings, cycle, sourceName);
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
      await this.runAgent(AgentKind.CONFIG, settings, cycle, sourceName);
    }

    // Detector-authoring agent — opt-in, off by default. Runs last so it can
    // react to what the config agent left unaddressed.
    if (await this.agentEnabled(AgentKind.DETECTOR_AUTHOR, cycle)) {
      await this.runAgent(
        AgentKind.DETECTOR_AUTHOR,
        settings,
        cycle,
        sourceName,
      );
    }

    // Escalation agent — opt-in, off by default. Runs last, once every case
    // mutation for this cycle has settled, so it alerts operators on the final
    // state of the open high-severity cases.
    if (await this.agentEnabled(AgentKind.ESCALATION, cycle)) {
      await this.runAgent(AgentKind.ESCALATION, settings, cycle, sourceName);
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
      throw error;
    }
  }

  private async inquiryMatchingPending(): Promise<boolean> {
    try {
      const boss = await this.pgBoss.getBossAsync();
      const stats = await boss.getQueueStats(INQUIRY_MATCH_QUEUE);
      return stats.queuedCount + stats.activeCount + stats.deferredCount > 0;
    } catch {
      return false;
    }
  }
}

export function formatSummary(s: ApplySummary): string {
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
  if (s.caseReadyInquiryIds.length > 0) {
    parts.push(
      `${s.caseReadyInquiryIds.length} inquiry(ies) flagged case-ready`,
    );
  }
  return parts.join('; ');
}
