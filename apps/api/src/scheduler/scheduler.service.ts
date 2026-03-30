import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { Job } from 'pg-boss';
import { TriggerType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from './pg-boss.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';

const JOB_NAME_PREFIX = 'ingest-source-';

function jobName(sourceId: string): string {
  return `${JOB_NAME_PREFIX}${sourceId}`;
}

@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulerService.name);
  /** Track which source queues already have a registered worker in this process */
  private readonly registeredQueues = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBossService: PgBossService,
    private readonly cliRunnerService: CliRunnerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.syncSchedulesFromDatabase();
  }

  private getBoss() {
    if ('getBossAsync' in this.pgBossService) {
      const maybeAsyncGetter = (
        this.pgBossService as PgBossService & {
          getBossAsync?: () => Promise<ReturnType<PgBossService['getBoss']>>;
        }
      ).getBossAsync;
      if (maybeAsyncGetter) {
        return maybeAsyncGetter.call(this.pgBossService);
      }
    }
    return Promise.resolve(this.pgBossService.getBoss());
  }

  /**
   * Register a pg-boss worker for a single source queue.
   * Idempotent — skips registration if the queue already has a worker in this process.
   */
  private async registerWorkerForSource(sourceId: string): Promise<void> {
    const name = jobName(sourceId);
    if (this.registeredQueues.has(name)) {
      return;
    }
    const boss = await this.getBoss();
    // pg-boss 12.x requires queues to exist in the database before work() can poll them
    await boss.createQueue(name);
    await boss.work(name, { localConcurrency: 1 }, (jobs: Job[]) =>
      this.handleIngestJob(jobs),
    );
    this.registeredQueues.add(name);
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
      },
    });

    this.logger.log(
      `Upserted schedule for source ${sourceId}: ${cron} (${timezone})`,
    );
  }

  async removeSchedule(sourceId: string): Promise<void> {
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
      },
    });

    this.logger.log(`Removed schedule for source ${sourceId}`);
  }

  async getSchedule(sourceId: string): Promise<{
    enabled: boolean;
    cron: string | null;
    timezone: string | null;
  }> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: {
        scheduleEnabled: true,
        scheduleCron: true,
        scheduleTimezone: true,
      },
    });

    if (!source) {
      return { enabled: false, cron: null, timezone: null };
    }

    return {
      enabled: source.scheduleEnabled,
      cron: source.scheduleCron,
      timezone: source.scheduleTimezone,
    };
  }
}
