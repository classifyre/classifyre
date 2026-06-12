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
import { InquiryAgentService } from './inquiry-agent.service';
import { CaseAgentService } from './case-agent.service';
import { DreamAgentService, DreamSummary } from './dream-agent.service';
import { AgentRunCancelledError } from './agent-runtime';
import type { ApplySummary } from './decision-applier.service';
import {
  AUTOPILOT_DREAM_CRON,
  AUTOPILOT_QUEUE,
  AUTOPILOT_RETRY_AFTER_SECONDS,
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
  /** Rerun of one specific agent — execute only it, bypassing enable-flags. */
  only?: AgentKind | null;
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
    private readonly inquiryAgent: InquiryAgentService,
    private readonly caseAgent: CaseAgentService,
    private readonly dreamAgent: DreamAgentService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
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
      const only =
        data?.agentKind && data.agentKind in AgentKind
          ? (data.agentKind as AgentKind)
          : null;
      if (data?.dream === true || only === AgentKind.DREAM) {
        await this.runDreamCycle({
          cycleKey:
            typeof data?.cycleKey === 'string' && data.cycleKey
              ? data.cycleKey
              : `dream:${new Date().toISOString().slice(0, 10)}`,
          trigger: manual || only ? 'manual' : 'schedule',
        });
        continue;
      }
      if (!sourceId && !manual && !only) continue;
      await this.runCycle({
        sourceId,
        runnerId,
        manual,
        only,
        instruction:
          typeof data?.instruction === 'string' && data.instruction.trim()
            ? data.instruction.trim()
            : null,
        cycleKey:
          typeof data?.cycleKey === 'string' && data.cycleKey
            ? data.cycleKey
            : `scan:${sourceId}:${runnerId ?? 'none'}`,
        trigger: manual ? 'manual' : 'scan_completed',
      });
    }
  }

  /** Scheduled or manually requested dream (memory consolidation) cycle. */
  private async runDreamCycle(input: {
    cycleKey: string;
    trigger: string;
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
        instruction: null,
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
    // Scan cycles respect the instance flags as master switches. Manual runs
    // are explicit operator intent and always execute (per-entity
    // OBSERVE_ONLY is still enforced by the decision applier).
    if (
      !cycle.manual &&
      !cycle.only &&
      !settings.autopilotInquiryEnabled &&
      !settings.autopilotCaseEnabled
    ) {
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

    // A rerun of one specific agent ("only") is explicit operator intent:
    // run exactly that agent and skip the other without a SKIPPED record.
    const inquiryEnabled = cycle.only
      ? cycle.only === AgentKind.INQUIRY
      : cycle.manual || settings.autopilotInquiryEnabled;
    const caseEnabled = cycle.only
      ? cycle.only === AgentKind.CASE
      : cycle.manual || settings.autopilotCaseEnabled;

    if (inquiryEnabled) {
      await this.runAgent(AgentKind.INQUIRY, settings, cycle, sourceName);
    } else if (!cycle.only) {
      await this.audit.recordSkippedRun(
        AgentKind.INQUIRY,
        cycle.sourceId ?? 'all',
        cycle.runnerId,
        'Inquiry autopilot disabled in settings; observing only.',
      );
    }

    if (caseEnabled) {
      await this.runAgent(AgentKind.CASE, settings, cycle, sourceName);
    } else if (!cycle.only) {
      await this.audit.recordSkippedRun(
        AgentKind.CASE,
        cycle.sourceId ?? 'all',
        cycle.runnerId,
        'Case autopilot disabled in settings; observing only.',
      );
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
    });
    if (run.status !== AgentRunStatus.RUNNING) return;

    await this.log.business(
      run.id,
      agentKind === AgentKind.DREAM
        ? `Dream cycle started: consolidating agent memory (${cycle.trigger}).`
        : cycle.manual
          ? `Manual ${agentKind.toLowerCase()} review started for ${sourceName}${cycle.instruction ? ' with operator instruction.' : '.'}`
          : `${agentKind === AgentKind.INQUIRY ? 'Inquiry' : 'Case'} cycle started after a scan of ${sourceName}.`,
      cycle.instruction ? { instruction: cycle.instruction } : undefined,
    );

    // Manual runs and targeted reruns override the instance flags (explicit
    // operator intent); the applier still enforces per-entity OBSERVE_ONLY.
    const effectiveSettings: InstanceSettings =
      cycle.manual || cycle.only
        ? {
            ...settings,
            autopilotInquiryEnabled: true,
            autopilotCaseEnabled: true,
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
      state: {},
    };
    const agent =
      agentKind === AgentKind.INQUIRY
        ? this.inquiryAgent
        : agentKind === AgentKind.CASE
          ? this.caseAgent
          : this.dreamAgent;

    try {
      const summary = await agent.execute(ctx);
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

function formatSummary(s: ApplySummary | DreamSummary): string {
  if ('journal' in s) {
    return `${s.deleted} memory deletion(s), ${s.rewritten} rewrite(s), ${s.created} new note(s), ${s.failed} failed. ${s.journal}`;
  }
  const parts = [
    `${s.applied} applied`,
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
