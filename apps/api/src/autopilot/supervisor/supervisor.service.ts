import { Injectable, Logger } from '@nestjs/common';
import {
  AgentKind,
  AgentMemoryOrigin,
  AgentRunStatus,
  Prisma,
  SupervisorGoalKind,
  SupervisorGoalStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  CAPABILITY_GROUPS,
  SWITCHABLE_GROUP_IDS,
  grantedToolNames,
  type CapabilityGroup,
} from './capabilities';
import type { Tool } from '../tools/tool.types';
import {
  DEFAULT_CHARTER,
  SUPERVISOR_DEFAULT_SLEEP_MINUTES,
  SUPERVISOR_INBOX_LINES,
  SUPERVISOR_JOURNAL_WINDOW,
  SUPERVISOR_MIN_SLEEP_MINUTES,
  type SupervisorEventType,
} from './supervisor.constants';

export interface WakeRequest {
  afterMinutes?: number | null;
  onEvents?: string[] | null;
  reason: string;
}

export interface BudgetStatus {
  /** Null when the provider has no pricing configured, so cost is unknowable. */
  spentTodayUsd: number | null;
  limitUsd: number | null;
  remainingUsd: number | null;
  exhausted: boolean;
  /** Wakes today, so pacing has something to stand on. */
  wakesToday: number;
  purgesToday: number;
  purgeBudgetPerDay: number;
}

/**
 * State, goals, journal, inbox and budget for the supervisor.
 *
 * Everything the supervisor knows about itself between wakes lives here. A
 * plain data service on purpose: the wake loop, its tools and the REST
 * controller all read the same rows, so there is one answer to "what is it
 * doing" no matter who is asking.
 */
@Injectable()
export class SupervisorService {
  private readonly logger = new Logger(SupervisorService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── State ──────────────────────────────────────────────────────────────────

  /** The singleton, created on first read so nothing has to seed it. */
  async state() {
    return this.prisma.supervisorState.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  /**
   * Record when the supervisor next intends to wake.
   *
   * Clamped at both ends. The floor stops "wake me in one minute" turning the
   * loop into a spin; the ceiling is the liveness guarantee, because an agent
   * that can schedule itself past the horizon can schedule itself out of
   * existence and nothing else would notice.
   */
  async scheduleWake(
    request: WakeRequest,
    maxSleepHours: number,
  ): Promise<{ nextWakeAt: Date; clamped: boolean; onEvents: string[] }> {
    const maxMinutes = Math.max(maxSleepHours, 1) * 60;
    const requested = request.afterMinutes ?? SUPERVISOR_DEFAULT_SLEEP_MINUTES;
    const minutes = Math.min(
      Math.max(requested, SUPERVISOR_MIN_SLEEP_MINUTES),
      maxMinutes,
    );
    const onEvents = (request.onEvents ?? []).filter(
      (e): e is string => typeof e === 'string' && e.length > 0,
    );
    const nextWakeAt = new Date(Date.now() + minutes * 60_000);

    await this.prisma.supervisorState.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        nextWakeAt,
        wakeOnEvents: onEvents,
        wakeReason: request.reason,
      },
      update: {
        nextWakeAt,
        wakeOnEvents: onEvents,
        wakeReason: request.reason,
      },
    });

    return { nextWakeAt, clamped: minutes !== requested, onEvents };
  }

  async markWoken(): Promise<void> {
    await this.prisma.supervisorState.upsert({
      where: { id: 1 },
      create: { id: 1, lastWakeAt: new Date() },
      update: { lastWakeAt: new Date() },
    });
  }

  async recordNoop(noop: boolean): Promise<void> {
    await this.prisma.supervisorState.upsert({
      where: { id: 1 },
      create: { id: 1, consecutiveNoops: noop ? 1 : 0 },
      update: noop
        ? { consecutiveNoops: { increment: 1 } }
        : { consecutiveNoops: 0 },
    });
  }

  // ── Capabilities ───────────────────────────────────────────────────────────

  /**
   * Groups currently switched on, with the always-on ones always present.
   *
   * Derived from the stored exception list, so a group added in a later release
   * is on for an instance that never expressed an opinion about it — and an
   * unknown id left over from a removed group is simply ignored rather than
   * poisoning the set.
   */
  async enabledCapabilityIds(): Promise<string[]> {
    const state = await this.state();
    const disabled = new Set(state.disabledCapabilities);
    return CAPABILITY_GROUPS.filter(
      (g) => g.alwaysOn || !disabled.has(g.id),
    ).map((g) => g.id);
  }

  /** The menu, with each group's current position. */
  async capabilities(): Promise<
    Array<CapabilityGroup & { enabled: boolean; toolCount: number }>
  > {
    const enabled = new Set(await this.enabledCapabilityIds());
    return CAPABILITY_GROUPS.map((g) => ({
      ...g,
      enabled: g.alwaysOn || enabled.has(g.id),
      toolCount: 0,
    }));
  }

  async setDisabledCapabilities(ids: string[]): Promise<string[]> {
    const disabled = ids.filter((id) => SWITCHABLE_GROUP_IDS.includes(id));
    await this.prisma.supervisorState.upsert({
      where: { id: 1 },
      create: { id: 1, disabledCapabilities: disabled },
      update: { disabledCapabilities: disabled },
    });
    return disabled;
  }

  /**
   * What the supervisor may CALL this wake.
   *
   * Not the same list as what its prompt describes, and never rendered into
   * one: this is typically a couple of hundred names. The loop checks calls
   * against it; `tools.search` reads it to answer "what can I reach".
   */
  async grantedTools(all: Tool[]): Promise<string[]> {
    return grantedToolNames(all, await this.enabledCapabilityIds());
  }

  async pause(until: Date | null): Promise<void> {
    await this.prisma.supervisorState.upsert({
      where: { id: 1 },
      create: { id: 1, pausedUntil: until },
      update: { pausedUntil: until },
    });
  }

  // ── Goals ──────────────────────────────────────────────────────────────────

  /**
   * Make sure a charter exists.
   *
   * Seeded lazily rather than in a migration: the text is prose that will be
   * edited over time, and prose in a migration is prose that can never be
   * corrected without drifting every tenant that already ran it.
   */
  async ensureCharter(): Promise<void> {
    const existing = await this.prisma.supervisorGoal.findFirst({
      where: { kind: SupervisorGoalKind.CHARTER },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.supervisorGoal.create({
      data: {
        kind: SupervisorGoalKind.CHARTER,
        origin: AgentMemoryOrigin.OPERATOR,
        title: DEFAULT_CHARTER.title,
        body: DEFAULT_CHARTER.body,
        priority: 100,
      },
    });
  }

  async listGoals(opts: { includeFinished?: boolean } = {}) {
    return this.prisma.supervisorGoal.findMany({
      where: opts.includeFinished
        ? undefined
        : {
            status: {
              in: [SupervisorGoalStatus.ACTIVE, SupervisorGoalStatus.PAUSED],
            },
          },
      orderBy: [{ kind: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createGoal(data: {
    kind?: SupervisorGoalKind;
    title: string;
    body?: string | null;
    priority?: number;
    parentId?: string | null;
    dueAt?: Date | null;
    origin?: AgentMemoryOrigin;
  }) {
    return this.prisma.supervisorGoal.create({
      data: {
        kind: data.kind ?? SupervisorGoalKind.GOAL,
        title: data.title,
        body: data.body ?? null,
        priority: data.priority ?? 0,
        parentId: data.parentId ?? null,
        dueAt: data.dueAt ?? null,
        origin: data.origin ?? AgentMemoryOrigin.OPERATOR,
      },
    });
  }

  /**
   * Update a goal.
   *
   * `agentAuthored` is the whole point of the second argument. An operator may
   * change anything; the agent may only record progress and close out its own
   * proposals. Letting it rewrite the title or body of an operator goal would
   * mean the instruction a person gave could quietly become the instruction the
   * agent preferred, and nothing downstream would show that it had happened.
   */
  async updateGoal(
    id: string,
    data: {
      title?: string;
      body?: string | null;
      status?: SupervisorGoalStatus;
      priority?: number;
      progress?: string | null;
      dueAt?: Date | null;
    },
    agentAuthored = false,
  ) {
    const existing = await this.prisma.supervisorGoal.findUnique({
      where: { id },
    });
    if (!existing) throw new Error(`Goal ${id} not found.`);

    if (agentAuthored && existing.origin === AgentMemoryOrigin.OPERATOR) {
      const refused = (['title', 'body'] as const).filter(
        (k) => data[k] !== undefined,
      );
      if (refused.length > 0) {
        throw new Error(
          `Refused: the ${refused.join(' and ')} of an operator-authored goal ` +
            `cannot be changed by an agent. Record what you have learned in ` +
            `\`progress\`, or propose a new goal alongside it.`,
        );
      }
    }

    return this.prisma.supervisorGoal.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.body !== undefined ? { body: data.body } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.progress !== undefined ? { progress: data.progress } : {}),
        ...(data.dueAt !== undefined ? { dueAt: data.dueAt } : {}),
      },
    });
  }

  async deleteGoal(id: string): Promise<void> {
    await this.prisma.supervisorGoal.delete({ where: { id } });
  }

  // ── Journal ────────────────────────────────────────────────────────────────

  async writeJournal(entry: {
    runId?: string | null;
    wakeReason: string;
    situation: string;
    did: string;
    next: string;
    goalIds?: string[];
    nextWakeAt?: Date | null;
    costUsd?: number | null;
  }) {
    return this.prisma.supervisorJournalEntry.create({
      data: {
        runId: entry.runId ?? null,
        wakeReason: entry.wakeReason,
        situation: entry.situation,
        did: entry.did,
        next: entry.next,
        goalIds: entry.goalIds ?? [],
        nextWakeAt: entry.nextWakeAt ?? null,
        costUsd:
          entry.costUsd === null || entry.costUsd === undefined
            ? null
            : new Prisma.Decimal(entry.costUsd),
      },
    });
  }

  async listJournal(opts: { limit?: number; before?: Date } = {}) {
    return this.prisma.supervisorJournalEntry.findMany({
      where: opts.before ? { createdAt: { lt: opts.before } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? SUPERVISOR_JOURNAL_WINDOW, 100),
    });
  }

  /** Attach an operator correction to one entry. Read back on the next wake. */
  async annotateJournal(id: string, note: string) {
    return this.prisma.supervisorJournalEntry.update({
      where: { id },
      data: { operatorNote: note },
    });
  }

  // ── Inbox ──────────────────────────────────────────────────────────────────

  /**
   * Record a fact worth waking for. Best-effort by design: the inbox is a
   * convenience for pacing, and a lost row must never fail the scan, cycle or
   * escalation that produced it.
   */
  async publish(event: {
    type: SupervisorEventType;
    summary: string;
    severity?: 'info' | 'warn' | 'error';
    payload?: Prisma.InputJsonValue;
  }): Promise<void> {
    try {
      await this.prisma.supervisorInboxEvent.create({
        data: {
          type: event.type,
          summary: event.summary,
          severity: event.severity ?? 'info',
          payload: event.payload,
        },
      });
    } catch (error) {
      this.logger.debug(
        `Supervisor inbox publish failed (${event.type}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async pendingEvents(limit = SUPERVISOR_INBOX_LINES) {
    return this.prisma.supervisorInboxEvent.findMany({
      where: { consumedAt: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async countPending(): Promise<number> {
    return this.prisma.supervisorInboxEvent.count({
      where: { consumedAt: null },
    });
  }

  /** Mark events read. Drained, not deleted, so the journal stays checkable. */
  async drainEvents(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.supervisorInboxEvent.updateMany({
      where: { id: { in: ids } },
      data: { consumedAt: new Date() },
    });
  }

  // ── Budget ─────────────────────────────────────────────────────────────────

  /**
   * What the supervisor has spent today, and what it has left.
   *
   * Summed from AgentRun.costUsd, already recorded per run including the
   * cached/uncached input split. Cost is null when the provider has no pricing
   * configured, and a null total is reported as unknown rather than as zero —
   * "we cannot measure this" and "this was free" lead to opposite decisions.
   */
  async budget(settings: {
    supervisorDailyCostLimitUsd?: Prisma.Decimal | null;
    supervisorPurgeBudgetPerDay?: number | null;
  }): Promise<BudgetStatus> {
    const since = startOfToday();
    const [runs, purges] = await Promise.all([
      this.prisma.agentRun.findMany({
        where: {
          agentKind: AgentKind.SUPERVISOR,
          createdAt: { gte: since },
          status: { not: AgentRunStatus.PENDING },
        },
        select: { costUsd: true },
      }),
      this.prisma.agentDecision.count({
        where: {
          createdAt: { gte: since },
          outcome: 'APPLIED',
          action: { in: ['PURGE_FINDINGS', 'PURGE_ASSETS'] },
        },
      }),
    ]);

    const priced = runs.filter((r) => r.costUsd !== null);
    const spent =
      priced.length === 0 && runs.length > 0
        ? null
        : priced.reduce((sum, r) => sum + Number(r.costUsd), 0);

    const limit =
      settings.supervisorDailyCostLimitUsd == null
        ? null
        : Number(settings.supervisorDailyCostLimitUsd);
    const capped = limit !== null && limit > 0;
    const remaining =
      capped && spent !== null ? Math.max(limit - spent, 0) : null;

    return {
      spentTodayUsd: spent,
      limitUsd: capped ? limit : null,
      remainingUsd: remaining,
      // An unmeasurable spend cannot exhaust a cap. Refusing to run because the
      // last run could not be priced would silence the agent on every provider
      // without configured pricing, which is most of them on first setup.
      exhausted: capped && spent !== null && spent >= limit,
      wakesToday: runs.length,
      purgesToday: purges,
      purgeBudgetPerDay: settings.supervisorPurgeBudgetPerDay ?? 0,
    };
  }
}

/** Local midnight. Budgets are a human unit, so they reset on a human day. */
export function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
