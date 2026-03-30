import { Module } from '@nestjs/common';
import { PgBossModule } from './pg-boss.module';
import { CliRunnerModule } from '../cli-runner/cli-runner.module';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [PgBossModule, CliRunnerModule],
  providers: [SchedulerService, PrismaService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
