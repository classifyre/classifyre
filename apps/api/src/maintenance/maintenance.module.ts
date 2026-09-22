import { Module } from '@nestjs/common';
import { CliRunnerModule } from '../cli-runner/cli-runner.module';
import { CorrelationModule } from '../correlation/correlation.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { PrismaService } from '../prisma.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { WorkspaceFeaturesService } from './workspace-features.service';

/**
 * Workspace storage overview, safe cleanup, and the feature switches that
 * decide whether the two storage-heavy engines run at all.
 *
 * Imports CliRunnerModule for RunnerLogStorageService (scan-log files are
 * removed alongside scan rows), CorrelationModule for the duplicate-detection
 * switch, lock and worker, and EmbeddingModule for the embeddings switch and
 * queue. None of them depends back on this module, so no DI cycle.
 * `PrismaService` is provided locally like in every other feature module: a
 * thin CLS-resolving proxy over the shared global client manager.
 */
@Module({
  imports: [CliRunnerModule, CorrelationModule, EmbeddingModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, WorkspaceFeaturesService, PrismaService],
  exports: [MaintenanceService, WorkspaceFeaturesService],
})
export class MaintenanceModule {}
