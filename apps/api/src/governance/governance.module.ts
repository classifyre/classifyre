import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { GovernanceController } from './governance.controller';
import { GovernanceColumnsService } from './governance-columns.service';
import { GovernanceInsightsService } from './governance-insights.service';
import { GovernanceService } from './governance.service';

/** Governed data assets (docs/prd/GOV-governed-data-assets.md). */
@Module({
  controllers: [GovernanceController],
  providers: [
    PrismaService,
    GovernanceService,
    GovernanceColumnsService,
    GovernanceInsightsService,
  ],
  exports: [GovernanceService, GovernanceInsightsService],
})
export class GovernanceModule {}
