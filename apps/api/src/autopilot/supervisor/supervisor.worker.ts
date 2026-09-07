import { Injectable, Logger } from '@nestjs/common';
import {
  AgentKind,
  AgentRunStatus,
  type InstanceSettings,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { Job } from 'pg-boss';
import { PrismaService } from '../../prisma.service';
import { PgBossService } from '../../scheduler/pg-boss.service';
import { AgentAuditService } from '../audit/agent-audit.service';
import { AgentLoggerService } from '../audit/agent-logger.service';
import { HarnessService } from '../harness/harness.service';
import { AgentRunCancelledError } from '../agent-runtime';
import type { AgentContext } from '../autopilot.types';
import { SupervisorService } from './supervisor.service';
import {
  SUPERVISOR_COALESCE_SECONDS,
  SUPERVISOR_DEFAULT_SLEEP_MINUTES,
  SUPERVISOR_QUEUE,
  SUPERVISOR_SINGLETON_KEY,
  SUPERVISOR_TICK_CRON,
} from './supervisor.constants';

/** The InstanceSettings singleton. */
const INSTANCE_SETTINGS_ID = 1;

interface SupervisorJob {
  /** An operator pressed "wake now". Bypasses the schedule, not the budget. */
  manual?: boolean;
  /** Operator steering for this wake only. */
  instruction?: string;
  /** The periodic check: run only if a wake is actually due. */
  tick?: boolean;
  /** The inbox event that brought the wake forward, if one did. */
  eventType?: string;
}

/**
 * The supervisor's wake loop.
 *
 * One turn per wake, resuming nothing. Where the other agents run as steps of a
 * cycle triggered by a scan, this one decides for itself when it next runs and
 * carries no conversation between wakes — its continuity is the journal, which
 * is what keeps an agent that runs indefinitely from costing indefinitely.
 *
 * Its own queue rather than a flag on the cycle queue: a cycle is a batch of
 * workers reacting to data, a wake is one agent deciding what should happen,
 * and sharing a singleton slot would let a busy scan cadence swallow wakes
 * exactly when there was most to decide.
 */
@Injectable()
export class SupervisorWorker {
  private readonly logger = new Logger(SupervisorWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
    private readonly supervisor: SupervisorService,
    private readonly harness: HarnessService,
    private readonly audit: AgentAuditService,
    private readonly log: AgentLoggerService,
  ) {}

  async registerForNamespace(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(SUPERVISOR_QUEUE);
    await this.pgBoss.work(SUPERVISOR_QUEUE, { localConcurrency: 1 }, (jobs) =>
      this.handle(jobs as Job[]),
    );
    // The backstop. A self-scheduling agent's only alarm clock is itself, so a
    // wake that dies before scheduling the next one would end the loop
    // permanently — and the symptom would be an agent that used to do things
    // and silently stopped, which this system has produced before.
    try {
      await boss.schedule(
        SUPERVISOR_QUEUE,
        SUPERVISOR_TICK_CRON,
        { tick: true },
        { tz: 'UTC' },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to register supervisor tick: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.logger.log(`Registered worker for queue ${SUPERVISOR_QUEUE}`);
  }

  /**
   * Ask for a wake.
   *
   * Coalesced rather than queued: a corpus cycle finishing writes an event per
   * worker within seconds, and waking five times to read five lines of the same
   * story is exactly the cost this design exists to avoid. pg-boss 12 dedupes
   * on `singletonSeconds` — a bare `singletonKey` on a standard queue does
   * nothing at all, which is a trap this codebase has already fallen into once.
   */
  async requestWake(job: SupervisorJob = {}): Promise<void> {
    try {
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(SUPERVISOR_QUEUE, job, {
        singletonKey: SUPERVISOR_SINGLETON_KEY,
        singletonSeconds: job.manual ? 0 : SUPERVISOR_COALESCE_SECONDS,
        retryLimit: 1,
        retryDelay: 120,
        expireInSeconds: 3 * 3600,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue supervisor wake: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The periodic check, called from the existing autopilot heartbeat.
   *
   * The backstop for a self-scheduling agent: the only thing that would
   * otherwise wake it is itself, so a wake that failed to schedule the next one
   * — a crash, a provider outage mid-turn — would end the loop permanently and
   * silently. A tick that finds nothing due does one indexed read and returns.
   */
  async tick(): Promise<void> {
    if (await this.wakeIsDue()) await this.requestWake({ tick: true });
  }

  private async handle(jobs: Job[]): Promise<void> {
    for (const job of jobs) {
      const data = (job.data ?? {}) as SupervisorJob;
      // A tick asks whether a wake is due; it is not itself the wake. Without
      // this the cron would run the agent every five minutes regardless of the
      // pacing it chose, which is the opposite of a self-paced loop.
      if (data.tick && !(await this.wakeIsDue())) continue;
      await this.runWake(data);
    }
  }

  /**
   * One wake.
   *
   * Every early return here schedules the next wake before leaving. A refusal
   * that does not is a loop that has quietly stopped, and the only symptom
   * would be an agent that used to do things and now does not — which is
   * exactly the failure mode this system has produced before, from four
   * different causes at once.
   */
  /** Whether the schedule says now, or an awaited event has already arrived. */
  private async wakeIsDue(): Promise<boolean> {
    const state = await this.supervisor.state();
    const now = new Date();
    if (state.pausedUntil && state.pausedUntil > now) return false;
    if (!state.nextWakeAt || state.nextWakeAt <= now) return true;
    if (state.wakeOnEvents.length === 0) return false;
    const pending = await this.prisma.supervisorInboxEvent.findFirst({
      where: { consumedAt: null, type: { in: state.wakeOnEvents } },
      select: { id: true },
    });
    return pending !== null;
  }

  private async runWake(job: SupervisorJob): Promise<void> {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
    });
    if (!settings) return;

    const refusal = await this.refusalReason(settings, job);
    if (refusal) {
      this.logger.debug(`Supervisor wake skipped: ${refusal.reason}`);
      await this.supervisor.scheduleWake(
        {
          afterMinutes: refusal.retryAfterMinutes,
          onEvents: [],
          reason: refusal.reason,
        },
        settings.supervisorMaxSleepHours,
      );
      if (refusal.journal) {
        await this.supervisor.writeJournal({
          wakeReason: job.manual
            ? 'operator asked for a wake'
            : 'scheduled wake',
          situation: refusal.reason,
          did: 'Nothing — the wake was refused before a run was opened.',
          next: `Retry in about ${refusal.retryAfterMinutes} minutes.`,
        });
      }
      return;
    }

    const state = await this.supervisor.state();
    const wakeReason = job.manual
      ? 'an operator asked for a wake'
      : job.eventType
        ? `an event you asked to be woken by: ${job.eventType}`
        : state.wakeReason || 'a scheduled wake';

    const run = await this.audit.openRun(AgentKind.SUPERVISOR, {
      sourceId: null,
      runnerId: null,
      cycleKey: `supervisor:${randomUUID()}`,
      trigger: job.manual ? 'manual' : 'supervisor',
      instruction: job.instruction ?? null,
    });
    if (run.status !== AgentRunStatus.RUNNING) return;

    await this.supervisor.ensureCharter();
    await this.supervisor.markWoken();
    await this.log.business(run.id, `Supervisor woke: ${wakeReason}.`);

    const ctx: AgentContext = {
      run,
      settings,
      sourceId: null,
      sourceName: 'all sources',
      runnerId: null,
      // Not a "steer" run even when an operator pressed the button: `manual`
      // makes the worker treat instance enable-flags as overridden, and an
      // operator asking the supervisor to think is not an instruction to
      // override the switches they set on everything else.
      manual: false,
      instruction: job.instruction ?? null,
      state: {},
    };

    const before = await this.countDecisions(run.id);
    try {
      const summary = await this.harness.execute(ctx);
      await this.audit.complete(run.id, formatWake(summary));
      await this.log.business(run.id, `Wake finished: ${formatWake(summary)}`);
      await this.ensureWakeScheduled(run.id, settings, wakeReason);
      const after = await this.countDecisions(run.id);
      await this.supervisor.recordNoop(after === before);
    } catch (error) {
      if (error instanceof AgentRunCancelledError) {
        await this.log.business(run.id, 'Wake cancelled by the operator.');
      } else {
        const message = error instanceof Error ? error.message : String(error);
        await this.audit.fail(run.id, message);
        this.logger.warn(`Supervisor wake failed: ${message}`);
      }
      // A failed wake still has to schedule the next one, or the agent is over.
      await this.ensureWakeScheduled(run.id, settings, 'the last wake failed');
    }
  }

  /**
   * Why this wake should not happen, or null.
   *
   * Ordered by how cheaply it can be answered, and every branch carries how
   * long to wait before trying again — a refusal with no retry is a stop.
   */
  private async refusalReason(
    settings: InstanceSettings,
    job: SupervisorJob,
  ): Promise<{
    reason: string;
    retryAfterMinutes: number;
    journal: boolean;
  } | null> {
    if (!settings.supervisorEnabled) {
      return {
        reason: 'The supervisor is switched off.',
        retryAfterMinutes: 60,
        journal: false,
      };
    }
    if (!settings.harnessAiProviderConfigId) {
      return {
        reason: 'No AI provider is assigned to the harness.',
        retryAfterMinutes: 60,
        journal: false,
      };
    }

    const state = await this.supervisor.state();
    const now = new Date();
    if (!job.manual && state.pausedUntil && state.pausedUntil > now) {
      return {
        reason: `Paused by the operator until ${state.pausedUntil.toISOString()}.`,
        retryAfterMinutes: Math.max(
          Math.ceil((state.pausedUntil.getTime() - now.getTime()) / 60_000),
          5,
        ),
        journal: false,
      };
    }

    // Never two wakes at once. A second one would read a journal the first has
    // not written yet and decide from a stale picture.
    const active = await this.prisma.agentRun.count({
      where: {
        agentKind: AgentKind.SUPERVISOR,
        status: { in: [AgentRunStatus.PENDING, AgentRunStatus.RUNNING] },
      },
    });
    if (active > 0) {
      return {
        reason: 'A wake is already in progress.',
        retryAfterMinutes: 15,
        journal: false,
      };
    }

    const budget = await this.supervisor.budget(settings);
    if (budget.exhausted) {
      const minutesToMidnight = Math.max(
        Math.ceil((endOfToday().getTime() - now.getTime()) / 60_000),
        5,
      );
      await this.supervisor.publish({
        type: 'budget_exhausted',
        severity: 'warn',
        summary: `Daily spend cap of $${budget.limitUsd?.toFixed(2)} reached after ${budget.wakesToday} wake(s).`,
      });
      return {
        reason:
          `The daily spend cap of $${budget.limitUsd?.toFixed(2)} is used up ` +
          `($${budget.spentTodayUsd?.toFixed(4)} across ${budget.wakesToday} wakes). ` +
          `Sleeping until it resets.`,
        retryAfterMinutes: minutesToMidnight,
        // Worth a journal entry: an operator looking at a quiet supervisor
        // should find the reason in the place they are already looking.
        journal: true,
      };
    }

    return null;
  }

  /**
   * Guarantee a next wake exists.
   *
   * The mission requires the agent to call schedule_wake and the loop refuses a
   * finish without it, but neither survives a crash mid-turn or a model that
   * ignores both. This is the floor: if the run left no future wake, put one in.
   */
  private async ensureWakeScheduled(
    runId: string,
    settings: InstanceSettings,
    reason: string,
  ): Promise<void> {
    const state = await this.supervisor.state();
    if (state.nextWakeAt && state.nextWakeAt > new Date()) return;
    await this.supervisor.scheduleWake(
      {
        afterMinutes: SUPERVISOR_DEFAULT_SLEEP_MINUTES,
        onEvents: [],
        reason: `Fallback: the wake ended without scheduling the next one (${reason}).`,
      },
      settings.supervisorMaxSleepHours,
    );
    await this.log.technical(
      runId,
      'Wake ended without scheduling the next one; applied the fallback interval.',
      undefined,
      'WARN',
    );
  }

  private async countDecisions(runId: string): Promise<number> {
    return this.prisma.agentDecision.count({
      where: { runId, outcome: 'APPLIED' },
    });
  }
}

/** Local end of day: the budget is a human unit and resets on a human day. */
function endOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d;
}

function formatWake(summary: { applied?: number; summary?: string }): string {
  if (summary.summary) return summary.summary;
  return `${summary.applied ?? 0} change(s) applied.`;
}
