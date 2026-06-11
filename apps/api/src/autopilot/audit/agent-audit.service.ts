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
import { AUTOPILOT_MAX_ATTEMPTS } from '../autopilot.constants';

export interface RecordDecisionInput {
  action: AgentDecisionAction;
  outcome: AgentDecisionOutcome;
  rationale: string;
  entityType?: 'inquiry' | 'case';
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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find a resumable run for this trigger (RUNNING/FAILED with attempts left —
   * e.g. after a crash or provider failure) or create a fresh one.
   */
  async openRun(
    agentKind: AgentKind,
    sourceId: string,
    runnerId: string | null,
  ): Promise<AgentRun> {
    const existing = await this.prisma.agentRun.findFirst({
      where: {
        agentKind,
        sourceId,
        runnerId,
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
        sourceId,
        runnerId,
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
