import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { GovernanceController } from './governance.controller';
import { GovernanceService } from './governance.service';

/** Governed data assets (docs/prd/GOV-governed-data-assets.md). */
@Module({
  controllers: [GovernanceController],
  providers: [PrismaService, GovernanceService],
  exports: [GovernanceService],
})
export class GovernanceModule {}
