import { Injectable } from '@nestjs/common';
import {
  AgentDecisionAction,
  AgentDecisionOutcome,
  AgentKind,
  AgentRun,
  AgentRunStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AgentLoggerService } from './agent-logger.service';
import { AUTOPILOT_MAX_ATTEMPTS } from '../autopilot.constants';

export interface RecordDecisionInput {
  action: AgentDecisionAction;
  outcome: AgentDecisionOutcome;
  rationale: string;
  entityType?:
    | 'inquiry'
    | 'case'
    | 'asset'
    | 'cluster'
    | 'source'
    | 'detector'
    | 'memory'
    | 'system';
  entityId?: string;
  /** Exact mutation input (or rejection detail) for auditability/replay. */
  payload?: Record<string, unknown>;
  /** Stable key so resumed runs never apply the same decision twice. */
  dedupeKey?: string;
}

/**
 * Audit trail for autopilot cycles. Every cycle is an AgentRun; every
 * (non-)action is an AgentDecision with a mandatory rationale.
 */
@Injectable()
export class AgentAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly log: AgentLoggerService,
  ) {}

  /**
   * Find a resumable run for this cycle (RUNNING/FAILED with attempts left —
   * e.g. after a crash or provider failure) or create a fresh one. The cycle
   * is identified by cycleKey so distinct manual triggers never resume each
   * other's runs.
   */
  async openRun(
    agentKind: AgentKind,
    cycle: {
      sourceId: string | null;
      runnerId: string | null;
      cycleKey: string;
      trigger: string;
      instruction?: string | null;
      caseId?: string | null;
    },
  ): Promise<AgentRun> {
    const existing = await this.prisma.agentRun.findFirst({
      where: {
        agentKind,
        cycleKey: cycle.cycleKey,
        status: {
          in: [
            AgentRunStatus.PENDING,
            AgentRunStatus.RUNNING,
            AgentRunStatus.FAILED,
          ],
        },
        attempts: { lt: AUTOPILOT_MAX_ATTEMPTS },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return this.prisma.agentRun.update({
        where: { id: existing.id },
        data: {
          status: AgentRunStatus.RUNNING,
          attempts: { increment: 1 },
          startedAt: existing.startedAt ?? new Date(),
          error: null,
        },
      });
    }
    return this.prisma.agentRun.create({
      data: {
        agentKind,
        sourceId: cycle.sourceId,
        runnerId: cycle.runnerId,
        cycleKey: cycle.cycleKey,
        trigger: cycle.trigger,
        instruction: cycle.instruction ?? null,
        caseId: cycle.caseId ?? null,
        status: AgentRunStatus.RUNNING,
        attempts: 1,
        startedAt: new Date(),
      },
    });
  }

  async saveStep(
    runId: string,
    stepName: string,
    state: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        currentStep: stepName,
        stepState: state as Prisma.InputJsonValue,
      },
    });
  }

  async complete(runId: string, summary: string): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: AgentRunStatus.COMPLETED,
        summary,
        finishedAt: new Date(),
        currentStep: null,
      },
    });
  }

  async skip(runId: string, summary: string): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: { status: AgentRunStatus.SKIPPED, summary, finishedAt: new Date() },
    });
  }

  async fail(runId: string, error: unknown): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: AgentRunStatus.FAILED,
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      },
    });
  }

  /** Operator stop request: flips a PENDING/RUNNING/FAILED run to CANCELLED. */
  async cancel(runId: string): Promise<boolean> {
    const result = await this.prisma.agentRun.updateMany({
      where: {
        id: runId,
        status: {
          in: [
            AgentRunStatus.PENDING,
            AgentRunStatus.RUNNING,
            AgentRunStatus.FAILED,
          ],
        },
      },
      data: {
        status: AgentRunStatus.CANCELLED,
        finishedAt: new Date(),
        error: 'Cancelled by the operator',
      },
    });
    return result.count > 0;
  }

  /** Polled by the pipeline between steps to honor stop requests. */
  async isCancelled(runId: string): Promise<boolean> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    return run?.status === AgentRunStatus.CANCELLED;
  }

  /** Create a SKIPPED run directly (autopilot disabled, no provider, …). */
  async recordSkippedRun(
    agentKind: AgentKind,
    sourceId: string,
    runnerId: string | null,
    summary: string,
  ): Promise<void> {
    await this.prisma.agentRun.create({
      data: {
        agentKind,
        sourceId,
        runnerId,
        status: AgentRunStatus.SKIPPED,
        summary,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
  }

  /**
   * Record one decision. Idempotent per run when a dedupeKey is given:
   * a resumed run skips decisions it already recorded.
   * Returns false when the decision already existed.
   */
  async recordDecision(
    runId: string,
    input: RecordDecisionInput,
  ): Promise<boolean> {
    if (input.dedupeKey && (await this.hasDecision(runId, input.dedupeKey)))
      return false;
    await this.prisma.agentDecision.create({
      data: {
        runId,
        action: input.action,
        outcome: input.outcome,
        entityType: input.entityType,
        entityId: input.entityId,
        rationale: input.rationale,
        payload: {
          ...(input.payload ?? {}),
          ...(input.dedupeKey ? { _dedupeKey: input.dedupeKey } : {}),
        },
      },
    });
    // Mirror every decision into the business log so the narrative is complete.
    const target = input.entityType
      ? ` on ${input.entityType}${input.entityId ? ` ${input.entityId}` : ''}`
      : '';
    await this.log.business(
      runId,
      `[${input.outcome}] ${input.action}${target} — ${input.rationale}`,
      input.payload,
      input.outcome === 'FAILED' ? 'WARN' : 'INFO',
    );
    return true;
  }

  async hasDecision(runId: string, dedupeKey: string): Promise<boolean> {
    const found = await this.prisma.agentDecision.findFirst({
      where: { runId, payload: { path: ['_dedupeKey'], equals: dedupeKey } },
      select: { id: true },
    });
    return found !== null;
  }
}
