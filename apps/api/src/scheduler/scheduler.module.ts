import { Module } from '@nestjs/common';
import { PgBossModule } from './pg-boss.module';
import { CliRunnerModule } from '../cli-runner/cli-runner.module';
import { SchedulerService } from './scheduler.service';
import { AutoScheduleService } from './auto-schedule.service';
import { RunnerCleanupService } from './runner-cleanup.service';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from '../notifications.service';
import { WorkerQueuesService } from './worker-queues.service';

@Module({
  imports: [PgBossModule, CliRunnerModule],
  providers: [
    SchedulerService,
    AutoScheduleService,
    RunnerCleanupService,
    PrismaService,
    NotificationsService,
    WorkerQueuesService,
  ],
  exports: [
    SchedulerService,
    AutoScheduleService,
    RunnerCleanupService,
    WorkerQueuesService,
  ],
})
export class SchedulerModule {}
