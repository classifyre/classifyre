import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FindingStatsService } from './finding-stats.service';
import { FindingStatsScheduler } from './finding-stats-scheduler.service';
import { FindingStatsWorker } from './finding-stats.worker';

/**
 * Pre-aggregated finding counts for the dashboard.
 *
 * Exported rather than global so the dependency direction stays one-way: the
 * services that write findings depend on the scheduler, and nothing in here
 * depends on them.
 */
@Module({
  providers: [
    PrismaService,
    FindingStatsService,
    FindingStatsScheduler,
    FindingStatsWorker,
  ],
  exports: [FindingStatsService, FindingStatsScheduler, FindingStatsWorker],
})
export class FindingStatsModule {}
