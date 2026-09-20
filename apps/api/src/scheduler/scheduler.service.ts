import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { RunnerStatus, SourceScheduleMode, TriggerType } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { PgBossService } from './pg-boss.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import { previousCronOccurrence } from './cron-window';

const JOB_NAME_PREFIX = 'ingest-source-';
/** Queue and cadence of the missed-window sweep (see catchUpMissedCronRuns). */
const CATCH_UP_QUEUE = 'cron-catchup';
const CATCH_UP_CRON = '*/10 * * * *';
/** Runs one pass may start, so a long outage cannot enqueue a whole namespace. */
const MAX_CATCH_UP_RUNS_PER_PASS = 5;

function jobName(sourceId: string): string {
  return `${JOB_NAME_PREFIX}${sourceId}`;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  /**
   * Track which source queues already have a registered worker in this process,
   * keyed by `<schema>:<queue>` so the same source id in different namespaces
   * (and the per-namespace bosses) are tracked independently.
   */
  private readonly registeredQueues = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBossService: PgBossService,
    private readonly cliRunnerService: CliRunnerService,
    private readonly cls: ClsService,
  ) {}

  /**
   * Registers all schedule workers for the CURRENT namespace (invoked by the
   * NamespaceWorkerManager inside the namespace's CLS context).
   */
  async registerForNamespace(): Promise<void> {
    await this.syncSchedulesFromDatabase();
    await this.registerCatchUpSchedule();
    // A window missed while this process was down is gone from pg-boss, so the
    // first thing a booting scheduler owes its sources is a look backwards.
    await this.catchUpMissedCronRuns();
  }

  /**
   * Re-check for missed windows on a timer as well as at boot: a window can
   * also pass while the source is already running, while the namespace is
   * paused, or while the single scan slot is held by another namespace.
   */
  private async registerCatchUpSchedule(): Promise<void> {
    const boss = await this.getBoss();
    const key = this.queueKey(CATCH_UP_QUEUE);
    if (!this.registeredQueues.has(key)) {
      await boss.createQueue(CATCH_UP_QUEUE);
      await this.pgBossService.work(
        CATCH_UP_QUEUE,
        { localConcurrency: 1 },
        () => this.catchUpMissedCronRuns(),
      );
      this.registeredQueues.add(key);
    }
    await boss.schedule(CATCH_UP_QUEUE, CATCH_UP_CRON, {}, { tz: 'UTC' });
  }

  /**
   * Start one run for each CRON source whose last window passed unserved.
   *
   * pg-boss only fires a cron while a scheduler is listening at that exact
   * minute; nothing replays a window missed while the instance was down. On an
   * instance that is not up around the clock that turns "daily at 06:15" into
   * "never": the GENESIS namespaces sat 25 hours stale with every schedule
   * enabled, because the pods were down at 04:15 UTC and came up at 07:49.
   *
   * One run per source per pass, oldest miss first, capped — a source that has
   * missed thirty windows needs one run, not thirty, and a namespace that has
   * been down for a week must not enqueue its whole catalogue at once.
   */
  async catchUpMissedCronRuns(): Promise<{ started: number }> {
    const sources = await this.prisma.source.findMany({
      where: {
        scheduleEnabled: true,
        scheduleMode: SourceScheduleMode.CRON,
        scheduleCron: { not: null },
      },
      select: {
        id: true,
        name: true,
        scheduleCron: true,
        scheduleTimezone: true,
        lastRunAt: true,
        runnerStatus: true,
      },
    });

    const due: Array<{ id: string; name: string; missedAt: Date }> = [];
    for (const source of sources) {
      // In flight already: the window is being served, or is queued behind the
      // scan slot. Either way this pass has nothing to add.
      if (
        source.runnerStatus === RunnerStatus.RUNNING ||
        source.runnerStatus === RunnerStatus.PENDING
      ) {
        continue;
      }
      const missedAt = previousCronOccurrence(
        source.scheduleCron as string,
        source.scheduleTimezone ?? 'UTC',
      );
      if (!missedAt) continue;
      if (source.lastRunAt && source.lastRunAt >= missedAt) continue;
      due.push({ id: source.id, name: source.name, missedAt });
    }

    due.sort((a, b) => a.missedAt.getTime() - b.missedAt.getTime());

    let started = 0;
    for (const source of due.slice(0, MAX_CATCH_UP_RUNS_PER_PASS)) {
      try {
        await this.cliRunnerService.startRun(
          source.id,
          TriggerType.SCHEDULED,
          'Scheduler (catch-up)',
        );
        started += 1;
        this.logger.log(
          `Catch-up run for "${source.name}": its ${source.missedAt.toISOString()} ` +
            `window passed while nothing was scheduling.`,
        );
      } catch (error) {
        // Paused namespace, source already claimed, or a cap reached: all
        // reasons to leave it for the next pass rather than fail the sweep.
        this.logger.warn(
          `Catch-up run for source ${source.id} not started: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (due.length > 0) {
      this.logger.log(
        `Cron catch-up: ${started} run(s) started of ${due.length} source(s) with a missed window.`,
      );
    }
    return { started };
  }

  clearForSchema(schema: string): void {
    const prefix = `${schema}:`;
    for (const key of this.registeredQueues) {
      if (key.startsWith(prefix)) this.registeredQueues.delete(key);
    }
  }

  private getBoss() {
    return this.pgBossService.getBossAsync();
  }

  private queueKey(name: string): string {
    return `${this.cls.get<string>(CLS_SCHEMA) ?? ''}:${name}`;
  }

  /**
   * Register a pg-boss worker for a single source queue on the current
   * namespace's boss. Idempotent per (namespace, queue).
   */
  private async registerWorkerForSource(sourceId: string): Promise<void> {
    const name = jobName(sourceId);
    const key = this.queueKey(name);
    if (this.registeredQueues.has(key)) {
      return;
    }
    const boss = await this.getBoss();
    // pg-boss 12.x requires queues to exist in the database before work() can poll them
    await boss.createQueue(name);
    await this.pgBossService.work(name, { localConcurrency: 1 }, (jobs) =>
      this.handleIngestJob(jobs as Job[]),
    );
    this.registeredQueues.add(key);
    this.logger.log(`Registered worker for queue ${name}`);
  }

  private async handleIngestJob(jobs: Job[]): Promise<void> {
    for (const job of jobs) {
      const sourceId = (job.data as Record<string, unknown>)?.sourceId;
      if (!sourceId || typeof sourceId !== 'string') {
        this.logger.warn(`Job ${job.id} has no valid sourceId, skipping`);
        continue;
      }

      this.logger.log(`Starting scheduled run for source ${sourceId}`);
      try {
        await this.cliRunnerService.startRun(
          sourceId,
          TriggerType.SCHEDULED,
          'Scheduler',
        );
      } catch (error) {
        if (error instanceof ConflictException) {
          this.logger.warn(
            `Skipping duplicate scheduled delivery for source ${sourceId}: ${error.message}`,
          );
          continue;
        }
        throw error;
      }
    }
  }

  private async syncSchedulesFromDatabase(): Promise<void> {
    const boss = await this.getBoss();

    const enabledSources = await this.prisma.source.findMany({
      where: { scheduleEnabled: true },
      select: { id: true, scheduleCron: true, scheduleTimezone: true },
    });

    const pgBossSchedules = await boss.getSchedules();
    const pgBossScheduleNames = new Set(pgBossSchedules.map((s) => s.name));
    const enabledSourceIds = new Set(enabledSources.map((s) => s.id));

    // Register workers and missing schedules for all enabled sources
    for (const source of enabledSources) {
      await this.registerWorkerForSource(source.id);

      if (!source.scheduleCron) {
        continue;
      }
      const name = jobName(source.id);
      if (!pgBossScheduleNames.has(name)) {
        await boss.schedule(
          name,
          source.scheduleCron,
          { sourceId: source.id },
          { tz: source.scheduleTimezone ?? 'UTC' },
        );
        this.logger.log(`Registered missing schedule for source ${source.id}`);
      }
    }

    // Remove stale schedules (sources deleted or disabled)
    for (const schedule of pgBossSchedules) {
      if (!schedule.name.startsWith(JOB_NAME_PREFIX)) {
        continue;
      }
      const sourceId = schedule.name.slice(JOB_NAME_PREFIX.length);
      if (!enabledSourceIds.has(sourceId)) {
        await boss.unschedule(schedule.name);
        this.logger.log(`Removed stale schedule for source ${sourceId}`);
      }
    }

    this.logger.log(
      `Schedule sync complete: ${enabledSources.length} enabled source(s)`,
    );
  }

  async upsertSchedule(
    sourceId: string,
    cron: string,
    timezone: string = 'UTC',
  ): Promise<void> {
    const boss = await this.getBoss();
    const name = jobName(sourceId);

    // Ensure a worker is listening on this source's queue before scheduling
    await this.registerWorkerForSource(sourceId);

    await boss.schedule(name, cron, { sourceId }, { tz: timezone });

    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        scheduleEnabled: true,
        scheduleCron: cron,
        scheduleTimezone: timezone,
        // Exactly one scheduler owns a source. Taking CRON also takes the
        // source out of AUTO and clears the due time the adaptive scheduler
        // was working from, so the two can never both start runs.
        scheduleMode: SourceScheduleMode.CRON,
        scheduleNextAt: null,
        autoReason: null,
      },
    });

    this.logger.log(
      `Upserted schedule for source ${sourceId}: ${cron} (${timezone})`,
    );
  }

  /**
   * Drop the pg-boss cron schedule for a source.
   *
   * `nextMode` is what takes over: OFF for "stop scheduling this source", AUTO
   * when the caller is handing the source to the adaptive scheduler (which then
   * sets the phase and due time itself). It is written here rather than by the
   * caller so a source is never briefly owned by neither scheduler.
   */
  async removeSchedule(
    sourceId: string,
    nextMode: SourceScheduleMode = SourceScheduleMode.OFF,
  ): Promise<void> {
    const boss = await this.getBoss();
    const name = jobName(sourceId);

    await boss.unschedule(name);

    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        scheduleEnabled: false,
        scheduleCron: null,
        // scheduleTimezone is NOT NULL in the DB — preserve the user's timezone
        // so it's retained when the schedule is re-enabled later.
        scheduleNextAt: null,
        scheduleMode: nextMode,
        ...(nextMode === SourceScheduleMode.OFF ? { autoReason: null } : {}),
      },
    });

    this.logger.log(`Removed schedule for source ${sourceId}`);
  }

  async getSchedule(sourceId: string): Promise<{
    enabled: boolean;
    cron: string | null;
    timezone: string | null;
    mode: SourceScheduleMode;
  }> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: {
        scheduleEnabled: true,
        scheduleCron: true,
        scheduleTimezone: true,
        scheduleMode: true,
      },
    });

    if (!source) {
      return {
        enabled: false,
        cron: null,
        timezone: null,
        mode: SourceScheduleMode.OFF,
      };
    }

    return {
      enabled: source.scheduleEnabled,
      cron: source.scheduleCron,
      timezone: source.scheduleTimezone,
      mode: source.scheduleMode,
    };
  }
}
