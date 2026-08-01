import { Module } from '@nestjs/common';
import { PgBossModule } from './pg-boss.module';
import { CliRunnerModule } from '../cli-runner/cli-runner.module';
import { SchedulerService } from './scheduler.service';
import { AutoScheduleService } from './auto-schedule.service';
import { RunnerCleanupService } from './runner-cleanup.service';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from '../notifications.service';

@Module({
  imports: [PgBossModule, CliRunnerModule],
  providers: [
    SchedulerService,
    AutoScheduleService,
    RunnerCleanupService,
    PrismaService,
    NotificationsService,
  ],
  exports: [SchedulerService, AutoScheduleService, RunnerCleanupService],
})
export class SchedulerModule {}
