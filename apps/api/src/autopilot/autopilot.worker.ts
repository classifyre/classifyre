import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { AgentKind, AgentRunStatus, InstanceSettings } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { AiSchemaError } from '../ai';
import { INQUIRY_MATCH_QUEUE } from '../matching/matching.constants';
import { AgentAuditService } from './audit/agent-audit.service';
import { AgentSearchService } from './search/agent-search.service';
import { InquiryAgentService } from './inquiry-agent.service';
import { CaseAgentService } from './case-agent.service';
import type { ApplySummary } from './decision-applier.service';
import {
  AUTOPILOT_QUEUE,
  AUTOPILOT_RETRY_AFTER_SECONDS,
} from './autopilot.constants';
import type { AgentContext, AutopilotJob } from './autopilot.types';

const INSTANCE_SETTINGS_ID = 1;

/**
 * Consumes AUTOPILOT_QUEUE jobs (enqueued with a debounce delay when a source
 * run finishes) and orchestrates one autopilot cycle: inquiry agent first,
 * then case agent. Each agent gets its own resumable AgentRun.
 */
@Injectable()
export class AutopilotWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutopilotWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
    private readonly audit: AgentAuditService,
    private readonly search: AgentSearchService,
    private readonly inquiryAgent: InquiryAgentService,
    private readonly caseAgent: CaseAgentService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(AUTOPILOT_QUEUE);
    await boss.work(AUTOPILOT_QUEUE, { localConcurrency: 1 }, (jobs: Job[]) =>
      this.handle(jobs),
    );
    this.logger.log(`Registered worker for queue ${AUTOPILOT_QUEUE}`);
  }

  private async handle(jobs: Job[]): Promise<void> {
    for (const job of jobs) {
      const data = job.data as Partial<AutopilotJob>;
      const sourceId =
        typeof data?.sourceId === 'string' ? data.sourceId : null;
      const runnerId =
        typeof data?.runnerId === 'string' ? data.runnerId : null;
      if (!sourceId) continue;
      await this.runCycle(sourceId, runnerId);
    }
  }

  async runCycle(sourceId: string, runnerId: string | null): Promise<void> {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
    });
    // Master switches: when autopilot is fully off this is not worth an audit row.
    if (
      !settings?.aiEnabled ||
      (!settings.autopilotInquiryEnabled && !settings.autopilotCaseEnabled)
    ) {
      this.logger.debug(
        `Autopilot disabled — skipping cycle for source ${sourceId}`,
      );
      return;
    }

    // Deterministic ordering: if inquiry matching for this scan is still queued,
    // push the cycle back instead of racing it.
    if (await this.inquiryMatchingPending()) {
      this.logger.log(
        `Inquiry matching still pending — re-queueing autopilot cycle for source ${sourceId}`,
      );
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(
        AUTOPILOT_QUEUE,
        { sourceId, runnerId: runnerId ?? undefined },
        {
          startAfter: AUTOPILOT_RETRY_AFTER_SECONDS,
          singletonKey: `autopilot:${sourceId}`,
        },
      );
      return;
    }

    const sourceName = await this.search.sourceName(sourceId);

    if (settings.autopilotInquiryEnabled) {
      await this.runAgent(
        AgentKind.INQUIRY,
        settings,
        sourceId,
        sourceName,
        runnerId,
      );
    } else {
      await this.audit.recordSkippedRun(
        AgentKind.INQUIRY,
        sourceId,
        runnerId,
        'Inquiry autopilot disabled in settings; observing only.',
      );
    }

    if (settings.autopilotCaseEnabled) {
      await this.runAgent(
        AgentKind.CASE,
        settings,
        sourceId,
        sourceName,
        runnerId,
      );
    } else {
      await this.audit.recordSkippedRun(
        AgentKind.CASE,
        sourceId,
        runnerId,
        'Case autopilot disabled in settings; observing only.',
      );
    }
  }

  private async runAgent(
    agentKind: AgentKind,
    settings: InstanceSettings,
    sourceId: string,
    sourceName: string,
    runnerId: string | null,
  ): Promise<void> {
    const run = await this.audit.openRun(agentKind, sourceId, runnerId);
    if (run.status !== AgentRunStatus.RUNNING) return;

    const ctx: AgentContext = {
      run,
      settings,
      sourceId,
      sourceName,
      runnerId,
      state: {},
    };
    const agent =
      agentKind === AgentKind.INQUIRY ? this.inquiryAgent : this.caseAgent;

    try {
      const summary = await agent.execute(ctx);
      await this.audit.complete(run.id, formatSummary(summary));
      this.logger.log(
        `${agentKind} agent run ${run.id} completed: ${formatSummary(summary)}`,
      );
    } catch (error) {
      if (error instanceof AiSchemaError) {
        // The model could not produce valid output even after completeJson's
        // correction retries — document it and stop; a retry with identical
        // context is unlikely to do better.
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

function formatSummary(s: ApplySummary): string {
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
