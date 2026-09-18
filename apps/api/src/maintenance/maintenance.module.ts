import { Module } from '@nestjs/common';
import { CliRunnerModule } from '../cli-runner/cli-runner.module';
import { PrismaService } from '../prisma.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

/**
 * Workspace storage overview + safe cleanup. Imports CliRunnerModule only
 * for RunnerLogStorageService (scan-log files are removed alongside scan
 * rows); there is no dependency back, so no DI cycle. `PrismaService` is
 * provided locally like in every other feature module: a thin CLS-resolving
 * proxy over the shared global client manager.
 */
@Module({
  imports: [CliRunnerModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, PrismaService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
