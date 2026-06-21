import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentKind, AgentRunStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { AgentAuditService } from './audit/agent-audit.service';
import { SystemBriefService } from './harness/system-brief.service';
import { ToolRegistry } from './tools/tool-registry.service';
import {
  INQUIRY_MISSION,
  CASE_MISSION,
  CONFIG_MISSION,
  DETECTOR_AUTHOR_MISSION,
  DREAM_MISSION,
} from './harness/missions';
import { AUTOPILOT_QUEUE } from './autopilot.constants';
import {
  AgentActivityItemDto,
  AgentActivityListResponseDto,
  AgentDecisionDto,
  HarnessToolsResponseDto,
  AgentLogDto,
  AgentLogListResponseDto,
  AgentMemoryDto,
  AgentMemoryListResponseDto,
  AgentRunDetailDto,
  AgentRunDto,
  AgentRunListResponseDto,
  AgentSystemBriefDto,
  AutopilotStatsDto,
  CreateAgentMemoryDto,
  QueryAgentActivityDto,
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
    private readonly audit: AgentAuditService,
    private readonly brief: SystemBriefService,
    private readonly tools: ToolRegistry,
  ) {}

  /** The capability map: every registered tool + the missions that wield them. */
  getTools(): HarnessToolsResponseDto {
    const missions = [
      INQUIRY_MISSION,
      CASE_MISSION,
      CONFIG_MISSION,
      DETECTOR_AUTHOR_MISSION,
      DREAM_MISSION,
    ];
    return {
      tools: this.tools.list().map((tool) => ({
        name: tool.name,
        description: tool.description,
        sideEffect: tool.sideEffect,
        domain: tool.domain ?? null,
      })),
      missions: missions.map((m) => ({
        kind: m.kind,
        goal: m.goal,
        allowedTools: m.allowedTools,
        maxIterations: m.maxIterations,
      })),
    };
  }

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
    if (dto.caseId) {
      const found = await this.prisma.case.findUnique({
        where: { id: dto.caseId },
        select: { id: true },
      });
      if (!found) {
        throw new BadRequestException(`Case ${dto.caseId} does not exist`);
      }
      if (dto.agentKind && dto.agentKind !== AgentKind.CASE) {
        throw new BadRequestException(
          'A case-focused run targets the CASE agent — omit agentKind or set it to CASE.',
        );
      }
    }
    if (dto.agentKind === AgentKind.DREAM) {
      throw new BadRequestException(
        'Use POST /autopilot/dream to trigger a dream cycle.',
      );
    }

    // Focusing on a case implies the case agent only.
    const agentKind = dto.caseId ? AgentKind.CASE : dto.agentKind;

    const cycleKey = `manual:${randomUUID()}`;
    const boss = await this.pgBoss.getBossAsync();
    await boss.send(
      AUTOPILOT_QUEUE,
      {
        manual: true,
        cycleKey,
        instruction: dto.instruction?.trim() || undefined,
        sourceId: dto.sourceId || undefined,
        agentKind: agentKind ?? undefined,
        caseId: dto.caseId || undefined,
      },
      // Spaced retries so provider rate limits (429) get room to clear;
      // resumed deliveries skip already-completed steps via stepState.
      {
        retryLimit: 2,
        retryDelay: 90,
        retryBackoff: true,
        expireInSeconds: 3 * 3600,
      },
    );
    return { cycleKey, enqueued: true };
  }

  /**
   * Enqueue a dream (memory consolidation) cycle right now, outside the
   * every-other-day schedule.
   */
  async triggerDream(): Promise<TriggerAutopilotResponseDto> {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: 1 },
      select: { aiEnabled: true, aiProviderConfigId: true },
    });
    if (!settings?.aiEnabled || !settings.aiProviderConfigId) {
      throw new BadRequestException(
        'Enable AI and select a default provider in Settings before triggering a dream cycle.',
      );
    }
    const cycleKey = `dream:manual:${randomUUID()}`;
    const boss = await this.pgBoss.getBossAsync();
    await boss.send(
      AUTOPILOT_QUEUE,
      { dream: true, manual: true, cycleKey },
      {
        retryLimit: 2,
        retryDelay: 90,
        retryBackoff: true,
        expireInSeconds: 3 * 3600,
      },
    );
    return { cycleKey, enqueued: true };
  }

  // ── Run control (stop / rerun) ──────────────────────────────────────────────

  /**
   * Stop a pending/running agent run. The pipeline aborts before its next
   * step (an in-flight model call is never interrupted mid-request).
   */
  async cancelRun(id: string): Promise<AgentRunDto> {
    const run = await this.prisma.agentRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Agent run ${id} not found`);
    const cancelled = await this.audit.cancel(id);
    if (!cancelled) {
      throw new BadRequestException(
        `Run ${id} is ${run.status} — only PENDING, RUNNING or FAILED runs can be cancelled.`,
      );
    }
    return this.getRun(id);
  }

  /**
   * Re-execute one specific agent run: the run is reset to PENDING with a
   * clean slate (fresh context, no reused step output) and re-enqueued so
   * ONLY its agent executes again under the original cycle identity.
   */
  async rerunRun(id: string): Promise<TriggerAutopilotResponseDto> {
    const run = await this.prisma.agentRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Agent run ${id} not found`);
    if (run.status === AgentRunStatus.RUNNING) {
      throw new BadRequestException(
        `Run ${id} is still RUNNING — cancel it first or wait for it to finish.`,
      );
    }
    if (!run.cycleKey) {
      throw new BadRequestException(
        `Run ${id} has no cycle identity and cannot be rerun.`,
      );
    }

    await this.prisma.agentRun.update({
      where: { id },
      data: {
        status: AgentRunStatus.PENDING,
        attempts: 0,
        error: null,
        summary: null,
        currentStep: null,
        stepState: Prisma.DbNull,
        finishedAt: null,
      },
    });

    const boss = await this.pgBoss.getBossAsync();
    await boss.send(
      AUTOPILOT_QUEUE,
      {
        cycleKey: run.cycleKey,
        agentKind: run.agentKind,
        dream: run.agentKind === AgentKind.DREAM || undefined,
        manual: run.trigger === 'manual' || undefined,
        instruction: run.instruction ?? undefined,
        sourceId: run.sourceId ?? undefined,
        runnerId: run.runnerId ?? undefined,
        caseId: run.caseId ?? undefined,
      },
      {
        retryLimit: 2,
        retryDelay: 90,
        retryBackoff: true,
        expireInSeconds: 3 * 3600,
      },
    );
    return { cycleKey: run.cycleKey, enqueued: true };
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
    const where: Prisma.AgentLogWhereInput = { runId };
    if (query.channel) where.channel = query.channel;
    if (query.level) where.level = query.level;
    if (query.search?.trim()) {
      where.message = { contains: query.search.trim(), mode: 'insensitive' };
    }
    const rows = await this.prisma.agentLog.findMany({
      where,
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
    if (query.caseId) where.caseId = query.caseId;
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.trigger) where.trigger = query.trigger;
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { summary: { contains: term, mode: 'insensitive' } },
        { instruction: { contains: term, mode: 'insensitive' } },
        { error: { contains: term, mode: 'insensitive' } },
      ];
    }
    const createdAt = dateRange(query.since, query.until);
    if (createdAt) where.createdAt = createdAt;

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

  /**
   * Cross-run activity feed — the business timeline. Every AgentDecision joined
   * with its run's kind/status, server-side filtered and paginated. This is the
   * primary "observe what the autopilot is doing" surface.
   */
  async listActivity(
    query: QueryAgentActivityDto,
  ): Promise<AgentActivityListResponseDto> {
    const skip = Math.max(0, Number(query.skip ?? 0) || 0);
    const limit = Math.min(Math.max(1, Number(query.limit ?? 50) || 50), 200);

    const where: Prisma.AgentDecisionWhereInput = {};
    if (query.action) where.action = query.action;
    if (query.outcome) where.outcome = query.outcome;
    if (query.entityType) where.entityType = query.entityType;
    if (query.search?.trim()) {
      where.rationale = { contains: query.search.trim(), mode: 'insensitive' };
    }
    const createdAt = dateRange(query.since, query.until);
    if (createdAt) where.createdAt = createdAt;
    if (query.agentKind) where.run = { agentKind: query.agentKind };

    const [rows, total] = await Promise.all([
      this.prisma.agentDecision.findMany({
        where,
        include: { run: { select: { agentKind: true, status: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.agentDecision.count({ where }),
    ]);

    return {
      items: rows.map(
        (d): AgentActivityItemDto => ({
          id: d.id,
          runId: d.runId,
          agentKind: d.run.agentKind,
          runStatus: d.run.status,
          action: d.action,
          outcome: d.outcome,
          entityType: d.entityType,
          entityId: d.entityId,
          rationale: d.rationale,
          payload: (d.payload ?? null) as Record<string, unknown> | null,
          createdAt: d.createdAt,
        }),
      ),
      total,
      skip,
      limit,
    };
  }

  /** Operator-authored create/update of the system-brief narrative. */
  async updateSystemBrief(content: string): Promise<AgentSystemBriefDto> {
    await this.brief.update({ content }, 'operator');
    return this.getSystemBrief();
  }

  /** The living system brief — what the autopilot understands about the system. */
  async getSystemBrief(): Promise<AgentSystemBriefDto> {
    const b = await this.brief.get();
    const row = await this.prisma.agentSystemBrief.findUnique({
      where: { id: 1 },
      select: { updatedAt: true },
    });
    return {
      content: b.content,
      facts: b.facts,
      version: b.version,
      updatedBy: b.updatedBy,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** Mission-control counters for the observability header. */
  async getStats(): Promise<AutopilotStatsDto> {
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const [
      totalRuns,
      runsLast24h,
      activeRuns,
      decisionsApplied,
      decisionsSkipped,
      decisionsFailed,
      memoryCount,
      brief,
      lastRun,
      byKind,
    ] = await Promise.all([
      this.prisma.agentRun.count(),
      this.prisma.agentRun.count({ where: { createdAt: { gte: since24h } } }),
      this.prisma.agentRun.count({
        where: { status: { in: ['RUNNING', 'PENDING'] } },
      }),
      this.prisma.agentDecision.count({ where: { outcome: 'APPLIED' } }),
      this.prisma.agentDecision.count({
        where: { outcome: 'SKIPPED_OBSERVE_ONLY' },
      }),
      this.prisma.agentDecision.count({ where: { outcome: 'FAILED' } }),
      this.prisma.agentMemory.count(),
      this.prisma.agentSystemBrief.findUnique({
        where: { id: 1 },
        select: { version: true },
      }),
      this.prisma.agentRun.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.agentRun.groupBy({ by: ['agentKind'], _count: true }),
    ]);

    const runsByKind: Record<string, number> = {};
    for (const g of byKind) runsByKind[String(g.agentKind)] = g._count;

    return {
      totalRuns,
      runsLast24h,
      activeRuns,
      decisionsApplied,
      decisionsSkipped,
      decisionsFailed,
      memoryCount,
      briefVersion: brief?.version ?? 0,
      lastActivityAt: lastRun?.createdAt ?? null,
      runsByKind,
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
      caseId: run.caseId,
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

/** Build a Prisma DateTime filter from optional ISO bounds (ignores invalid). */
function dateRange(
  since?: string,
  until?: string,
): Prisma.DateTimeFilter | undefined {
  const filter: Prisma.DateTimeFilter = {};
  if (since) {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) filter.gte = d;
  }
  if (until) {
    const d = new Date(until);
    if (!Number.isNaN(d.getTime())) filter.lte = d;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}
