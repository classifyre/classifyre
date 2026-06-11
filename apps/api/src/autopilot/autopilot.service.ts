import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  AgentDecisionDto,
  AgentRunDetailDto,
  AgentRunDto,
  AgentRunListResponseDto,
  QueryAgentRunsDto,
} from './dto/autopilot.dto';

/** Read API over the autopilot audit trail (runs + decisions with rationale). */
@Injectable()
export class AutopilotService {
  constructor(private readonly prisma: PrismaService) {}

  async listRuns(query: QueryAgentRunsDto): Promise<AgentRunListResponseDto> {
    const skip = Math.max(0, Number(query.skip ?? 0) || 0);
    const limit = Math.min(Math.max(1, Number(query.limit ?? 50) || 50), 200);

    const where: Prisma.AgentRunWhereInput = {};
    if (query.agentKind) where.agentKind = query.agentKind;
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      this.prisma.agentRun.findMany({
        where,
        include: { _count: { select: { decisions: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.agentRun.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.mapRun(r, r._count.decisions)),
      total,
      skip,
      limit,
    };
  }

  async getRun(id: string): Promise<AgentRunDetailDto> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id },
      include: { decisions: { orderBy: { createdAt: 'asc' } } },
    });
    if (!run) throw new NotFoundException(`Agent run ${id} not found`);
    return {
      ...this.mapRun(run, run.decisions.length),
      decisions: run.decisions.map((d) => this.mapDecision(d)),
    };
  }

  private mapRun(
    run: Prisma.AgentRunGetPayload<object>,
    decisionCount: number,
  ): AgentRunDto {
    return {
      id: run.id,
      agentKind: run.agentKind,
      status: run.status,
      sourceId: run.sourceId,
      runnerId: run.runnerId,
      trigger: run.trigger,
      attempts: run.attempts,
      error: run.error,
      summary: run.summary,
      decisionCount,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: run.createdAt,
    };
  }

  private mapDecision(
    d: Prisma.AgentDecisionGetPayload<object>,
  ): AgentDecisionDto {
    return {
      id: d.id,
      action: d.action,
      outcome: d.outcome,
      entityType: d.entityType,
      entityId: d.entityId,
      rationale: d.rationale,
      payload: (d.payload ?? null) as Record<string, unknown> | null,
      createdAt: d.createdAt,
    };
  }
}
