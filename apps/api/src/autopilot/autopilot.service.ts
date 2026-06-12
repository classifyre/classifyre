import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { AUTOPILOT_QUEUE } from './autopilot.constants';
import {
  AgentDecisionDto,
  AgentLogDto,
  AgentLogListResponseDto,
  AgentMemoryDto,
  AgentMemoryListResponseDto,
  AgentRunDetailDto,
  AgentRunDto,
  AgentRunListResponseDto,
  CreateAgentMemoryDto,
  QueryAgentLogsDto,
  QueryAgentMemoryDto,
  QueryAgentRunsDto,
  TriggerAutopilotDto,
  TriggerAutopilotResponseDto,
  UpdateAgentMemoryDto,
} from './dto/autopilot.dto';

/**
 * API over the autopilot: audit trail (runs, decisions, logs), memory
 * management (the operator can inspect and correct what the agent learned)
 * and the manual "steer" trigger.
 */
@Injectable()
export class AutopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
  ) {}

  // ── Manual trigger ──────────────────────────────────────────────────────────

  /**
   * Enqueue a manual autopilot cycle. Reviews ALL existing open data (optionally
   * narrowed to one source) with the operator instruction embedded into the
   * prompts. Fully async — same pg-boss pattern as scan-triggered cycles.
   */
  async trigger(
    dto: TriggerAutopilotDto,
  ): Promise<TriggerAutopilotResponseDto> {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: 1 },
      select: { aiEnabled: true, aiProviderConfigId: true },
    });
    if (!settings?.aiEnabled || !settings.aiProviderConfigId) {
      throw new BadRequestException(
        'Enable AI and select a default provider in Settings before triggering the autopilot.',
      );
    }
    if (dto.sourceId) {
      const source = await this.prisma.source.findUnique({
        where: { id: dto.sourceId },
        select: { id: true },
      });
      if (!source) {
        throw new BadRequestException(`Source ${dto.sourceId} does not exist`);
      }
    }

    const cycleKey = `manual:${randomUUID()}`;
    const boss = await this.pgBoss.getBossAsync();
    await boss.send(
      AUTOPILOT_QUEUE,
      {
        manual: true,
        cycleKey,
        instruction: dto.instruction?.trim() || undefined,
        sourceId: dto.sourceId || undefined,
      },
      // Spaced retries so provider rate limits (429) get room to clear;
      // resumed deliveries skip already-completed steps via stepState.
      { retryLimit: 2, retryDelay: 90, retryBackoff: true },
    );
    return { cycleKey, enqueued: true };
  }

  // ── Logs ────────────────────────────────────────────────────────────────────

  async listLogs(
    runId: string,
    query: QueryAgentLogsDto,
  ): Promise<AgentLogListResponseDto> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { id: true },
    });
    if (!run) throw new NotFoundException(`Agent run ${runId} not found`);
    const rows = await this.prisma.agentLog.findMany({
      where: { runId, ...(query.channel ? { channel: query.channel } : {}) },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });
    return {
      items: rows.map(
        (r): AgentLogDto => ({
          id: r.id,
          channel: r.channel,
          level: r.level,
          message: r.message,
          payload: (r.payload ?? null) as Record<string, unknown> | null,
          createdAt: r.createdAt,
        }),
      ),
    };
  }

  // ── Memory management ───────────────────────────────────────────────────────

  async listMemory(
    query: QueryAgentMemoryDto,
  ): Promise<AgentMemoryListResponseDto> {
    const skip = Math.max(0, Number(query.skip ?? 0) || 0);
    const limit = Math.min(Math.max(1, Number(query.limit ?? 50) || 50), 200);
    const where: Prisma.AgentMemoryWhereInput = {};
    if (query.kind) where.kind = query.kind;
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { key: { contains: term, mode: 'insensitive' } },
        { content: { contains: term, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.agentMemory.findMany({
        where,
        orderBy: [{ weight: 'desc' }, { updatedAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.agentMemory.count({ where }),
    ]);
    return { items: rows.map((r) => this.mapMemory(r)), total, skip, limit };
  }

  async createMemory(dto: CreateAgentMemoryDto): Promise<AgentMemoryDto> {
    const key = dto.key.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 200);
    if (!key) throw new BadRequestException('key cannot be empty');
    const row = await this.prisma.agentMemory.upsert({
      where: { kind_key: { kind: dto.kind, key } },
      create: {
        kind: dto.kind,
        key,
        content: dto.content.trim(),
        tags: dto.tags ?? [],
      },
      update: { content: dto.content.trim(), tags: dto.tags ?? [] },
    });
    return this.mapMemory(row);
  }

  async updateMemory(
    id: string,
    dto: UpdateAgentMemoryDto,
  ): Promise<AgentMemoryDto> {
    const existing = await this.prisma.agentMemory.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException(`Memory ${id} not found`);
    const row = await this.prisma.agentMemory.update({
      where: { id },
      data: {
        content: dto.content?.trim(),
        tags: dto.tags,
        weight: dto.weight,
      },
    });
    return this.mapMemory(row);
  }

  async deleteMemory(id: string): Promise<void> {
    const existing = await this.prisma.agentMemory.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Memory ${id} not found`);
    await this.prisma.agentMemory.delete({ where: { id } });
  }

  private mapMemory(row: Prisma.AgentMemoryGetPayload<object>): AgentMemoryDto {
    return {
      id: row.id,
      kind: row.kind,
      key: row.key,
      content: row.content,
      tags: row.tags,
      refType: row.refType,
      refId: row.refId,
      weight: row.weight,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

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
      instruction: run.instruction,
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
