import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'pg-boss';
import {
  AutoSchedulePhase,
  RunnerStatus,
  Severity,
  SourceScheduleMode,
  TriggerType,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from './pg-boss.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';
import { NotificationsService } from '../notifications.service';
import {
  NotificationEvent,
  NotificationType,
} from '../types/notification.types';
import {
  AUTO_SCHEDULE_ACTOR,
  AUTO_SCHEDULE_QUEUE,
  AUTO_SCHEDULE_TICK_CRON,
  BACKOFF_BASE_SECONDS,
  BACKOFF_MAX_SECONDS,
  CATCH_UP_COOLDOWN_SECONDS,
  CIRCUIT_BREAK_FAILURES,
  MAX_CONSECUTIVE_CATCH_UP_RUNS,
  MAX_DUE_SOURCES_PER_TICK,
  MIN_AGENT_INTERVAL_SECONDS,
  NO_PROGRESS_RUNS_TO_CONVERGE,
  STEADY_GROWTH_FACTOR,
  STEADY_MAX_SECONDS,
  STEADY_MIN_SECONDS,
  maxConcurrentAutoScans,
} from './auto-schedule.constants';

const INSTANCE_SETTINGS_ID = 1;

/** Job shapes on {@link AUTO_SCHEDULE_QUEUE}. */
interface AutoScheduleJob {
  /** A run finished — fold its outcome into that source's schedule. */
  sourceId?: string;
  runnerId?: string;
}

/** Everything the API and the harness need to explain a source's cadence. */
export interface AutoScheduleStatus {
  mode: SourceScheduleMode;
  phase: AutoSchedulePhase;
  nextRunAt: Date | null;
  intervalSeconds: number | null;
  noProgressStreak: number;
  catchUpRuns: number;
  consecutiveFailures: number;
  /** True once the sweep has converged: STEADY, i.e. only new data is picked up. */
  sweepConverged: boolean;
  reason: string | null;
}

/** The outcome of one run, as the state machine sees it. */
type RunOutcome = 'PROGRESS' | 'NO_PROGRESS' | 'FAILED';

/** The runner columns the state machine reads. */
interface ResolvedRun {
  id: string;
  sourceId: string;
  status: RunnerStatus;
  assetsCreated: number;
  assetsUpdated: number;
  assetsDeleted: number;
}

/**
 * Adaptive source scheduling.
 *
 * A cron expression answers "when", which is the wrong question during an
 * initial ingest: the right cadence is "again, as soon as the last one
 * finished" while data is still arriving, and "occasionally" once it is not.
 * This service closes that loop using the only ground truth available — what
 * the previous run actually ingested.
 *
 *   CATCH_UP  run ingested something  → next run in {@link CATCH_UP_COOLDOWN_SECONDS}
 *   STEADY    N runs ingested nothing → next run in an interval that doubles
 *             per quiet run, from {@link STEADY_MIN_SECONDS} to {@link STEADY_MAX_SECONDS}
 *   BACKOFF   run failed              → exponential in consecutive failures
 *   PAUSED    kept failing            → stop; notify an operator
 *
 * Any progress resets the interval and returns the source to CATCH_UP, so a
 * source that has been quiet for a day and then gains a thousand documents is
 * swept at full speed again without anyone touching it.
 *
 * Two things drive the loop, deliberately:
 *  - a post-run kick (latency: the next run starts a minute after the last),
 *  - a one-minute cron reconciliation (correctness: a kick lost to a pod
 *    restart cannot strand a source, because the tick re-derives the due set
 *    from the database).
 *
 * Runs started by anything else — an operator, a cron schedule, the harness's
 * `sources.rescan` — feed the same machine: they complete, they report what
 * they ingested, and the schedule moves. The agents therefore cannot fight the
 * scheduler; a re-scan they trigger *is* the source's next run.
 */
@Injectable()
export class AutoScheduleService {
  private readonly logger = new Logger(AutoScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
    private readonly cliRunner: CliRunnerService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Register the tick worker + cron on the CURRENT namespace's pg-boss
   * (invoked by the NamespaceWorkerManager inside the namespace's CLS context).
   */
  async registerForNamespace(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(AUTO_SCHEDULE_QUEUE);
    await this.pgBoss.work(
      AUTO_SCHEDULE_QUEUE,
      { localConcurrency: 1 },
      (jobs) => this.handle(jobs as Job[]),
    );
    try {
      await boss.schedule(
        AUTO_SCHEDULE_QUEUE,
        AUTO_SCHEDULE_TICK_CRON,
        {},
        {
          tz: 'UTC',
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to register auto-schedule tick: ${message(error)}`,
      );
    }
    this.logger.log(`Registered worker for queue ${AUTO_SCHEDULE_QUEUE}`);
  }

  private async handle(jobs: Job[]): Promise<void> {
    for (const job of jobs) {
      const data = (job.data ?? {}) as AutoScheduleJob;
      if (typeof data.sourceId === 'string' && data.sourceId) {
        await this.recordRunOutcome(
          data.sourceId,
          typeof data.runnerId === 'string' ? data.runnerId : null,
        );
      }
    }
    // Always reconcile afterwards: a post-run kick that has just freed a
    // concurrency slot is exactly when another source becomes startable.
    await this.tick();
  }

  /**
   * Notify the scheduler that a run finished. Fire-and-forget from the caller's
   * point of view — the tick reconciles anyway, so a dropped message costs
   * latency, never correctness.
   */
  async notifyRunFinished(sourceId: string, runnerId: string): Promise<void> {
    try {
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(
        AUTO_SCHEDULE_QUEUE,
        { sourceId, runnerId },
        { singletonKey: `auto-schedule:${sourceId}`, expireInSeconds: 600 },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue auto-schedule kick for source ${sourceId}: ${message(error)}`,
      );
    }
  }

  // ── State machine ──────────────────────────────────────────────────────────

  /**
   * Fold one finished run into its source's schedule.
   *
   * Runs for sources not in AUTO mode are ignored: the columns stay untouched
   * so switching a source to AUTO later starts from a clean CATCH_UP rather
   * than from state accumulated while something else owned the schedule.
   */
  async recordRunOutcome(
    sourceId: string,
    runnerId: string | null,
  ): Promise<void> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: {
        id: true,
        name: true,
        scheduleMode: true,
        autoPhase: true,
        autoIntervalSeconds: true,
        autoNoProgressStreak: true,
        autoCatchUpRuns: true,
        autoLastRunnerId: true,
        consecutiveFailures: true,
      },
    });
    if (!source || source.scheduleMode !== SourceScheduleMode.AUTO) return;
    if (source.autoPhase === AutoSchedulePhase.PAUSED) return;

    const run = await this.resolveRun(sourceId, runnerId);
    // pg-boss is at-least-once and the tick reconciles on top of the post-run
    // kick, so the same finished run reaches this method more than once. Fold
    // each run in exactly once or a single scan would advance the phase twice.
    if (!run || (run.id && run.id === source.autoLastRunnerId)) return;

    const outcome = this.classifyRun(sourceId, run);
    const now = new Date();
    const seen = { autoLastRunnerId: run.id };

    if (outcome === 'FAILED') {
      const failures = source.consecutiveFailures;
      if (failures >= CIRCUIT_BREAK_FAILURES) {
        await this.pause(
          source.id,
          source.name,
          `Paused after ${failures} consecutive failed scans. Fix the source, then resume it.`,
          seen,
        );
        return;
      }
      // `consecutiveFailures` is incremented by the runner before this runs, so
      // the first failure already backs off one step rather than retrying at
      // the catch-up cooldown.
      const delay = clamp(
        BACKOFF_BASE_SECONDS * 2 ** Math.max(0, failures - 1),
        BACKOFF_BASE_SECONDS,
        BACKOFF_MAX_SECONDS,
      );
      await this.write(source.id, {
        ...seen,
        autoPhase: AutoSchedulePhase.BACKOFF,
        scheduleNextAt: addSeconds(now, delay),
        autoReason: `Last scan failed (${failures} in a row) — retrying in ${humanize(delay)}.`,
      });
      return;
    }

    if (outcome === 'PROGRESS') {
      const catchUpRuns = source.autoCatchUpRuns + 1;
      if (catchUpRuns >= MAX_CONSECUTIVE_CATCH_UP_RUNS) {
        // Content that changes on every scan is not an unfinished sweep. Settle
        // rather than chase it forever.
        await this.write(source.id, {
          ...seen,
          autoPhase: AutoSchedulePhase.STEADY,
          autoIntervalSeconds: STEADY_MIN_SECONDS,
          autoNoProgressStreak: 0,
          autoCatchUpRuns: 0,
          scheduleNextAt: addSeconds(now, STEADY_MIN_SECONDS),
          autoReason:
            `Still ingesting after ${catchUpRuns} back-to-back scans — this source keeps ` +
            `changing rather than draining, so it moved to a ${humanize(STEADY_MIN_SECONDS)} cadence.`,
        });
        return;
      }
      await this.write(source.id, {
        ...seen,
        autoPhase: AutoSchedulePhase.CATCH_UP,
        autoIntervalSeconds: STEADY_MIN_SECONDS,
        autoNoProgressStreak: 0,
        autoCatchUpRuns: catchUpRuns,
        scheduleNextAt: addSeconds(now, CATCH_UP_COOLDOWN_SECONDS),
        autoReason: `Last scan ingested new data — continuing the sweep (run ${catchUpRuns}).`,
      });
      return;
    }

    // NO_PROGRESS.
    const streak = source.autoNoProgressStreak + 1;
    if (streak < NO_PROGRESS_RUNS_TO_CONVERGE) {
      // Not yet convincing. Stay in catch-up but do not count it as sweep
      // progress, so the catch-up cap still applies.
      await this.write(source.id, {
        ...seen,
        autoPhase: AutoSchedulePhase.CATCH_UP,
        autoNoProgressStreak: streak,
        scheduleNextAt: addSeconds(now, CATCH_UP_COOLDOWN_SECONDS),
        autoReason:
          'Last scan ingested nothing — confirming the sweep is finished with one more run.',
      });
      return;
    }

    const previous = source.autoIntervalSeconds ?? STEADY_MIN_SECONDS;
    const interval =
      source.autoPhase === AutoSchedulePhase.STEADY
        ? clamp(
            previous * STEADY_GROWTH_FACTOR,
            STEADY_MIN_SECONDS,
            STEADY_MAX_SECONDS,
          )
        : STEADY_MIN_SECONDS;
    await this.write(source.id, {
      ...seen,
      autoPhase: AutoSchedulePhase.STEADY,
      autoIntervalSeconds: interval,
      autoNoProgressStreak: streak,
      autoCatchUpRuns: 0,
      scheduleNextAt: addSeconds(now, interval),
      autoReason:
        interval >= STEADY_MAX_SECONDS
          ? `Nothing new for ${streak} scans — checking once a day for new data.`
          : `Sweep complete — checking every ${humanize(interval)} for new data.`,
    });
  }

  /**
   * What the run did, in the only terms the scheduler cares about.
   *
   * "Progress" is assets created, updated or deleted. Updates count because a
   * paginating sweep inside one large object (a Parquet file read a slice at a
   * time) advances by rewriting the same asset, so a created-only test would
   * declare that sweep finished after its first page.
   */
  /** The run this kick is about: the named one, or the source's latest. */
  private async resolveRun(
    sourceId: string,
    runnerId: string | null,
  ): Promise<ResolvedRun | null> {
    const select = {
      id: true,
      sourceId: true,
      status: true,
      assetsCreated: true,
      assetsUpdated: true,
      assetsDeleted: true,
    };
    return runnerId
      ? this.prisma.runner.findUnique({ where: { id: runnerId }, select })
      : this.prisma.runner.findFirst({
          where: { sourceId, completedAt: { not: null } },
          orderBy: { completedAt: 'desc' },
          select,
        });
  }

  /**
   * What the run did, in the only terms the scheduler cares about.
   *
   * "Progress" is assets created, updated or deleted. Updates count because a
   * paginating sweep inside one large object (a Parquet file read a slice at a
   * time) advances by rewriting the same asset, so a created-only test would
   * declare that sweep finished after its first page.
   */
  private classifyRun(sourceId: string, runner: ResolvedRun): RunOutcome {
    // A kick naming a runner that belongs to another source is a bug
    // elsewhere; treat it as no signal rather than acting on it.
    if (runner.sourceId !== sourceId) return 'NO_PROGRESS';
    if (runner.status === RunnerStatus.ERROR) return 'FAILED';
    const touched =
      runner.assetsCreated + runner.assetsUpdated + runner.assetsDeleted;
    return touched > 0 ? 'PROGRESS' : 'NO_PROGRESS';
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  /**
   * Start every AUTO source whose next run is due, up to the concurrency cap.
   *
   * Idempotent and safe to run concurrently in several replicas: a source is
   * claimed with a compare-and-set on the exact `scheduleNextAt` it was read
   * with, so only one caller can start it.
   */
  async tick(): Promise<void> {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
      select: { autoScheduleEnabled: true },
    });
    if (settings && !settings.autoScheduleEnabled) return;

    const limit = maxConcurrentAutoScans();
    if (limit === 0) return;

    // EVERY scan in flight counts, not just the adaptive scheduler's own.
    //
    // The thing being rationed is the instance's capacity to scan, and a cron
    // schedule an operator set, a run they started by hand, and an agent's
    // verification re-scan all consume it. Counting only AUTO sources here
    // meant `AUTO_SCHEDULE_MAX_CONCURRENT` really read "two adaptive scans ON
    // TOP OF whatever else is running" — so ten cron sources firing at 02:00
    // would have had two more piled on them, and with MAX_CONCURRENT_RUNNERS
    // unset (the default) nothing downstream would have objected.
    //
    // The consequence is deliberate: adaptive scanning is opportunistic and
    // yields to explicit intent. A busy instance simply gets fewer catch-up
    // runs, which is the correct trade — a source sweeping itself faster is
    // never worth delaying the schedule someone chose.
    const inFlight = await this.prisma.source.count({
      where: {
        runnerStatus: { in: [RunnerStatus.PENDING, RunnerStatus.RUNNING] },
      },
    });
    let budget = limit - inFlight;
    if (budget <= 0) {
      // Logged rather than silent: "why has my catch-up sweep stalled" should
      // be answerable from the log without reading this code.
      this.logger.debug(
        `Auto-schedule yielding: ${inFlight} scan(s) already in flight (cap ${limit}).`,
      );
      return;
    }

    const due = await this.prisma.source.findMany({
      where: {
        scheduleMode: SourceScheduleMode.AUTO,
        autoPhase: { not: AutoSchedulePhase.PAUSED },
        scheduleNextAt: { lte: new Date() },
        runnerStatus: { notIn: [RunnerStatus.PENDING, RunnerStatus.RUNNING] },
      },
      // Longest-overdue first, so a busy instance degrades into fair rotation
      // rather than starving whichever source sorts last.
      orderBy: { scheduleNextAt: 'asc' },
      take: MAX_DUE_SOURCES_PER_TICK,
      select: { id: true, name: true, scheduleNextAt: true },
    });

    for (const source of due) {
      if (budget <= 0) break;
      if (await this.start(source.id, source.name, source.scheduleNextAt)) {
        budget -= 1;
      }
    }
  }

  /** Claim and start one due source. Returns whether a run was started. */
  private async start(
    sourceId: string,
    sourceName: string,
    dueAt: Date | null,
  ): Promise<boolean> {
    // Claim: move the due time forward before starting, so a crash between the
    // claim and the run leaves a source that retries shortly rather than one
    // that is either stuck or being started twice.
    const claimed = await this.prisma.source.updateMany({
      where: {
        id: sourceId,
        scheduleMode: SourceScheduleMode.AUTO,
        scheduleNextAt: dueAt,
      },
      data: {
        scheduleNextAt: addSeconds(new Date(), CATCH_UP_COOLDOWN_SECONDS),
      },
    });
    if (claimed.count === 0) return false;

    try {
      await this.cliRunner.startRun(
        sourceId,
        TriggerType.SCHEDULED,
        AUTO_SCHEDULE_ACTOR,
      );
      this.logger.log(`Auto-scheduled scan started for "${sourceName}"`);
      return true;
    } catch (error) {
      if (error instanceof ConflictException) {
        // Something else started this source between the claim and here. The
        // run that IS in flight will report its own outcome.
        this.logger.debug(
          `Auto-schedule skipped "${sourceName}": a scan is already running.`,
        );
        return false;
      }
      // Could not start at all (source deleted, sandbox with no files, k8s
      // rejected the job). Back off instead of retrying every minute forever.
      await this.write(sourceId, {
        autoPhase: AutoSchedulePhase.BACKOFF,
        scheduleNextAt: addSeconds(new Date(), BACKOFF_BASE_SECONDS),
        autoReason: `Could not start a scan: ${message(error)}`,
      });
      this.logger.warn(
        `Auto-schedule could not start "${sourceName}": ${message(error)}`,
      );
      return false;
    }
  }

  // ── Mode / operator + agent surface ────────────────────────────────────────

  /**
   * Put a source into AUTO mode, starting a fresh sweep.
   *
   * The caller is responsible for removing any pg-boss cron schedule first —
   * see SchedulerService.removeSchedule — so the two schedulers can never both
   * own one source.
   */
  async enable(sourceId: string, reason: string): Promise<void> {
    await this.write(sourceId, {
      scheduleMode: SourceScheduleMode.AUTO,
      autoPhase: AutoSchedulePhase.CATCH_UP,
      autoIntervalSeconds: STEADY_MIN_SECONDS,
      autoNoProgressStreak: 0,
      autoCatchUpRuns: 0,
      scheduleNextAt: new Date(),
      autoReason: reason,
    });
  }

  /** Take a source out of AUTO mode (switching to CRON or off). */
  async disable(sourceId: string, mode: SourceScheduleMode): Promise<void> {
    await this.write(sourceId, {
      scheduleMode: mode,
      scheduleNextAt: null,
      autoReason: null,
    });
  }

  /**
   * Restart the sweep from the top.
   *
   * Called whenever something invalidates the "nothing new to read" conclusion:
   * a detector or sampling change (by an operator OR by the config-tuning
   * agent) means the existing assets must be looked at again, so a converged
   * source must not stay converged. Without this, an agent could retune a
   * source that is checked once a day and wait a day to find out whether the
   * change helped.
   */
  async resetToCatchUp(sourceId: string, reason: string): Promise<void> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { scheduleMode: true, autoPhase: true },
    });
    if (!source || source.scheduleMode !== SourceScheduleMode.AUTO) return;
    // A paused source stays paused: it is paused because it cannot scan, and a
    // config change is not evidence that it can.
    if (source.autoPhase === AutoSchedulePhase.PAUSED) return;
    await this.write(sourceId, {
      autoPhase: AutoSchedulePhase.CATCH_UP,
      autoIntervalSeconds: STEADY_MIN_SECONDS,
      autoNoProgressStreak: 0,
      autoCatchUpRuns: 0,
      scheduleNextAt: new Date(),
      autoReason: reason,
    });
  }

  /**
   * Pin a converged source to an explicit steady interval. The floor exists so
   * an agent (or a typo) cannot turn the scheduler into a hot loop.
   */
  async setSteadyInterval(
    sourceId: string,
    intervalSeconds: number,
    reason: string,
  ): Promise<number> {
    const interval = clamp(
      Math.round(intervalSeconds),
      MIN_AGENT_INTERVAL_SECONDS,
      STEADY_MAX_SECONDS,
    );
    await this.write(sourceId, {
      scheduleMode: SourceScheduleMode.AUTO,
      autoPhase: AutoSchedulePhase.STEADY,
      autoIntervalSeconds: interval,
      autoNoProgressStreak: NO_PROGRESS_RUNS_TO_CONVERGE,
      autoCatchUpRuns: 0,
      scheduleNextAt: addSeconds(new Date(), interval),
      autoReason: reason,
    });
    return interval;
  }

  /** Clear a PAUSED circuit breaker and try again. */
  async resume(sourceId: string, reason: string): Promise<void> {
    await this.write(sourceId, {
      autoPhase: AutoSchedulePhase.CATCH_UP,
      autoNoProgressStreak: 0,
      autoCatchUpRuns: 0,
      scheduleNextAt: new Date(),
      autoReason: reason,
    });
  }

  /** Everything needed to explain the source's cadence, for the API and tools. */
  async describe(sourceId: string): Promise<AutoScheduleStatus | null> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: {
        scheduleMode: true,
        autoPhase: true,
        scheduleNextAt: true,
        autoIntervalSeconds: true,
        autoNoProgressStreak: true,
        autoCatchUpRuns: true,
        autoReason: true,
        consecutiveFailures: true,
      },
    });
    if (!source) return null;
    return {
      mode: source.scheduleMode,
      phase: source.autoPhase,
      nextRunAt: source.scheduleNextAt,
      intervalSeconds: source.autoIntervalSeconds,
      noProgressStreak: source.autoNoProgressStreak,
      catchUpRuns: source.autoCatchUpRuns,
      consecutiveFailures: source.consecutiveFailures,
      sweepConverged:
        source.scheduleMode === SourceScheduleMode.AUTO &&
        source.autoPhase === AutoSchedulePhase.STEADY,
      reason: source.autoReason,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async pause(
    sourceId: string,
    sourceName: string,
    reason: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.write(sourceId, {
      ...extra,
      autoPhase: AutoSchedulePhase.PAUSED,
      scheduleNextAt: null,
      autoReason: reason,
    });
    this.logger.warn(`Auto-schedule paused for "${sourceName}": ${reason}`);
    try {
      await this.notifications.create({
        type: NotificationType.SOURCE,
        event: NotificationEvent.SOURCE_SCHEDULE_PAUSED,
        severity: Severity.HIGH,
        title: `Automatic scanning paused for ${sourceName}`,
        message: reason,
        sourceId,
        triggeredBy: AUTO_SCHEDULE_ACTOR,
        actionUrl: `/sources/${sourceId}`,
        isImportant: true,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to raise schedule-paused notification for ${sourceId}: ${message(error)}`,
      );
    }
  }

  /** Single write path, so a deleted source never fails a caller. */
  private async write(
    sourceId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.source.updateMany({ where: { id: sourceId }, data });
  }
}

function addSeconds(from: Date, seconds: number): Date {
  return new Date(from.getTime() + seconds * 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** "15 minutes", "6 hours" — for operator-facing reason strings. */
export function humanize(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(seconds / 86400);
  return `${days} day${days === 1 ? '' : 's'}`;
}
