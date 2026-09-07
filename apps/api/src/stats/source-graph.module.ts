import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SourceGraphService } from './source-graph.service';
import { SourceGraphScheduler } from './source-graph-scheduler.service';
import { SourceGraphWorker } from './source-graph.worker';

/**
 * The pre-aggregated source connection map behind the dashboard canvas.
 *
 * Separate from {@link FindingStatsModule} because the two rollups are refreshed
 * by different events — findings changing versus edges changing — and a scan
 * that emits no relationships should not rebuild this one.
 */
@Module({
  providers: [
    PrismaService,
    SourceGraphService,
    SourceGraphScheduler,
    SourceGraphWorker,
  ],
  exports: [SourceGraphService, SourceGraphScheduler, SourceGraphWorker],
})
export class SourceGraphModule {}
