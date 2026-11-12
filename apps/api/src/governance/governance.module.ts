import { Module } from '@nestjs/common';
import { GlossaryModule } from '../glossary/glossary.module';
import { DataQueryModule } from '../data-query/data-query.module';
import { GovernanceMeaningService } from './governance-meaning.service';
import { QualityService } from './quality.service';
import { QualityWorker } from './quality.worker';
import { PrismaService } from '../prisma.service';
import { GovernanceController } from './governance.controller';
import { GovernanceColumnsService } from './governance-columns.service';
import { GovernanceInsightsService } from './governance-insights.service';
import { GovernanceService } from './governance.service';

/** Governed data assets (docs/prd/GOV-governed-data-assets.md). */
@Module({
  imports: [GlossaryModule, DataQueryModule],
  controllers: [GovernanceController],
  providers: [
    PrismaService,
    GovernanceService,
    GovernanceColumnsService,
    GovernanceInsightsService,
    GovernanceMeaningService,
    QualityService,
    QualityWorker,
  ],
  exports: [
    GovernanceService,
    GovernanceInsightsService,
    QualityService,
    QualityWorker,
  ],
})
export class GovernanceModule {}
