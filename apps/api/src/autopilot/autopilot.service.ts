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
import { AgentConfigService } from './harness/agent-config.service';
import { McpClientService } from './mcp-client/mcp-client.service';
import { AUTOPILOT_QUEUE } from './autopilot.constants';
import { CORRELATION_QUEUE } from '../correlation/correlation.constants';
import type { AutopilotJob } from './autopilot.types';

/** Agents that run in canonical order as one chained cycle on the autopilot queue. */
const PIPELINE_KINDS = [
  AgentKind.INQUIRY,
  AgentKind.CASE,
  AgentKind.CONFIG,
  AgentKind.DETECTOR_AUTHOR,
  AgentKind.ESCALATION,
] as const;
import {
  AgentActivityItemDto,
  AgentActivityListResponseDto,
  AgentConfigDto,
  AgentConfigListResponseDto,
  AgentDecisionDto,
  HarnessToolsResponseDto,
  UpdateAgentConfigDto,
  AgentLogDto,
  AgentLogListResponseDto,
  AgentMemoryDto,
  AgentMemoryListResponseDto,
  AgentRunDetailDto,
  AgentRunDto,
  AgentRunListResponseDto,
  AgentSystemBriefDto,
  AgentUsageBucketDto,
  AgentUsageResponseDto,
  AgentUsageTotalsDto,
  AutopilotStatsDto,
  CreateAgentMemoryDto,
  QueryAgentActivityDto,
  QueryAgentLogsDto,
  QueryAgentMemoryDto,
  QueryAgentRunsDto,
  QueryAgentUsageDto,
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
    private readonly agentConfig: AgentConfigService,
    private readonly mcp: McpClientService,
  ) {}

  /** The capability map: every registered tool + the missions that wield them. */
  async getTools(): Promise<HarnessToolsResponseDto> {
    const agents = await this.agentConfig.list();
    return {
      tools: this.tools.list().map((tool) => ({
        name: tool.name,
        description: tool.description,
        sideEffect: tool.sideEffect,
        domain: tool.domain ?? null,
        source: tool.name.startsWith('mcp.') ? 'mcp' : 'builtin',
      })),
      missions: agents.map((a) => ({
        kind: a.kind,
        goal: a.goal,
        allowedTools: a.toolNames,
        maxIterations: a.maxIterations,
      })),
    };
  }

  // ── Per-agent configuration ───────────────────────────────────────────────────

  /** Every agent with its effective + default config and scoped MCP tools. */
  async getAgents(): Promise<AgentConfigListResponseDto> {
    const summaries = await this.agentConfig.list();
    return {
      agents: summaries.map((a) => ({
        ...a,
        mcpToolNames: this.mcp.toolNamesForKind(a.kind),
      })),
    };
  }

  /** Update one agent's enable flag / goal / iterations / assigned tools. */
  async updateAgent(
    kind: AgentKind,
    dto: UpdateAgentConfigDto,
  ): Promise<AgentConfigDto> {
    const summary = await this.agentConfig.update(kind, dto);
    return { ...summary, mcpToolNames: this.mcp.toolNamesForKind(kind) };
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
      if (
        dto.agentKinds?.length &&
        dto.agentKinds.some((k) => k !== AgentKind.CASE)
      ) {
        throw new BadRequestException(
          'A case-focused run targets the CASE agent — omit agentKinds or set it to [CASE].',
        );
      }
    }

    // Resolve which agents to run. A case-focused run implies the case agent;
    // omitting agentKinds means the full pipeline.
    const requested: readonly AgentKind[] = dto.caseId
      ? [AgentKind.CASE]
      : (dto.agentKinds ?? PIPELINE_KINDS);

    const pipeline = requested.filter((k) =>
      (PIPELINE_KINDS as readonly AgentKind[]).includes(k),
    );
    const wantsDream = requested.includes(AgentKind.DREAM);
    const wantsDuplicates = requested.includes(AgentKind.DUPLICATES);

    const instruction = dto.instruction?.trim() || undefined;
    // One shared cycle identity groups every job enqueued by this trigger.
    const cycleKey = `manual:${randomUUID()}`;
    const boss = await this.pgBoss.getBossAsync();
    const sendOpts = {
      retryLimit: 2,
      retryDelay: 90,
      retryBackoff: true,
      expireInSeconds: 3 * 3600,
    } as const;

    // Pipeline agents run in canonical order as one chained cycle.
    if (pipeline.length > 0) {
      await boss.send(
        AUTOPILOT_QUEUE,
        {
          manual: true,
          cycleKey,
          instruction,
          sourceId: dto.sourceId || undefined,
          agentKinds: pipeline as AutopilotJob['agentKinds'],
          caseId: dto.caseId || undefined,
        },
        sendOpts,
      );
    }

    // DREAM (memory consolidation) — steerable via the operator instruction.
    if (wantsDream) {
      await boss.send(
        AUTOPILOT_QUEUE,
        { dream: true, manual: true, cycleKey, instruction },
        sendOpts,
      );
    }

    // DUPLICATES (fingerprint consolidation) — deterministic global recompute on
    // the correlation queue; the instruction does not apply.
    if (wantsDuplicates) {
      await boss.send(
        CORRELATION_QUEUE,
        { recomputeAll: true, manual: true },
        {
          singletonKey: 'correlation:recompute-all',
          expireInSeconds: 6 * 3600,
        },
      );
    }

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
        agentKinds:
          run.agentKind === AgentKind.DREAM
            ? undefined
            : ([run.agentKind] as AutopilotJob['agentKinds']),
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
    const composed = await this.brief.compose();
    const row = await this.prisma.agentSystemBrief.findUnique({
      where: { id: 1 },
      select: { updatedAt: true },
    });
    return {
      content: composed.overview,
      facts: composed.facts,
      glossary: composed.glossary,
      topics: composed.topics,
      gaps: composed.gaps,
      setup: composed.setup,
      version: composed.version,
      updatedBy: composed.updatedBy,
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
      usage24h,
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
      this.prisma.agentRun.aggregate({
        where: { createdAt: { gte: since24h } },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      }),
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
      tokensLast24h:
        (usage24h._sum.inputTokens ?? 0) + (usage24h._sum.outputTokens ?? 0),
      costLast24h:
        usage24h._sum.costUsd != null ? Number(usage24h._sum.costUsd) : null,
    };
  }

  /**
   * Per-day, per-agent LLM token/cost aggregation for the harness usage
   * charts. Days are UTC; range defaults to the last 30 days.
   */
  async getUsage(query: QueryAgentUsageDto): Promise<AgentUsageResponseDto> {
    const until = parseDate(query.until) ?? new Date();
    const since =
      parseDate(query.since) ??
      new Date(until.getTime() - 30 * 24 * 3600 * 1000);

    const kindFilter = query.agentKind
      ? Prisma.sql`AND agent_kind = ${query.agentKind}::"AgentKind"`
      : Prisma.empty;

    const [rows, avgRows, settings] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          day: string;
          agent_kind: AgentKind;
          runs: number;
          input_tokens: bigint;
          output_tokens: bigint;
          cost_usd: number | null;
        }>
        // created_at is a naive timestamp already storing UTC, so truncate it
        // directly — an AT TIME ZONE conversion would re-render the day in the
        // DB session timezone and shift buckets off the UI's UTC day keys.
      >(Prisma.sql`
        SELECT
          to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
          agent_kind,
          COUNT(*)::int AS runs,
          COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
          COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
          SUM(cost_usd)::float8 AS cost_usd
        FROM agent_runs
        WHERE created_at >= ${since} AND created_at <= ${until}
          ${kindFilter}
        GROUP BY 1, 2
        ORDER BY 1 ASC, 2 ASC
      `),
      this.prisma.$queryRaw<Array<{ avg_ms: number | null }>>(Prisma.sql`
        SELECT AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)::float8 AS avg_ms
        FROM agent_runs
        WHERE created_at >= ${since} AND created_at <= ${until}
          AND started_at IS NOT NULL AND finished_at > started_at
          ${kindFilter}
      `),
      this.prisma.instanceSettings.findUnique({
        where: { id: 1 },
        select: {
          aiProviderConfig: {
            select: { inputCostPerMTok: true, outputCostPerMTok: true },
          },
        },
      }),
    ]);
    const avgMs = avgRows[0]?.avg_ms;
    const avgDurationMs = avgMs != null ? Math.round(Number(avgMs)) : null;

    const buckets: AgentUsageBucketDto[] = rows.map((r) => ({
      date: r.day,
      agentKind: r.agent_kind,
      runs: Number(r.runs),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      costUsd: r.cost_usd != null ? Number(r.cost_usd) : null,
    }));

    const totals: AgentUsageTotalsDto = {
      runs: buckets.reduce((a, b) => a + b.runs, 0),
      inputTokens: buckets.reduce((a, b) => a + b.inputTokens, 0),
      outputTokens: buckets.reduce((a, b) => a + b.outputTokens, 0),
      costUsd: buckets.some((b) => b.costUsd != null)
        ? buckets.reduce((a, b) => a + (b.costUsd ?? 0), 0)
        : null,
      avgDurationMs,
    };

    const pricing = settings?.aiProviderConfig;
    return {
      buckets,
      totals,
      pricingConfigured:
        pricing != null &&
        (pricing.inputCostPerMTok != null || pricing.outputCostPerMTok != null),
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
    // Wall-clock duration; an in-flight run measures up to "now".
    const durationEnd =
      run.finishedAt ??
      (run.status === AgentRunStatus.RUNNING ? new Date() : null);
    const durationMs =
      run.startedAt && durationEnd
        ? Math.max(0, durationEnd.getTime() - run.startedAt.getTime())
        : null;
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
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costUsd: run.costUsd != null ? Number(run.costUsd) : null,
      durationMs,
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

/** Parse an optional ISO timestamp; invalid or absent values become null. */
function parseDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Build a Prisma DateTime filter from optional ISO bounds (ignores invalid). */
function dateRange(
  since?: string,
  until?: string,
): Prisma.DateTimeFilter | undefined {
  const filter: Prisma.DateTimeFilter = {};
  const gte = parseDate(since);
  if (gte) filter.gte = gte;
  const lte = parseDate(until);
  if (lte) filter.lte = lte;
  return Object.keys(filter).length > 0 ? filter : undefined;
}
