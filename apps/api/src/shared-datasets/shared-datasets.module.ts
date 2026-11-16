import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataQueryModule } from '../data-query/data-query.module';
import { GovernanceModule } from '../governance/governance.module';
import { SharedDatasetsController } from './shared-datasets.controller';
import { SharedDatasetsService } from './shared-datasets.service';

/** Shared datasets: governed saved queries (docs/prd/DQ-data-query.md §5.12). */
@Module({
  imports: [DataQueryModule, GovernanceModule],
  controllers: [SharedDatasetsController],
  providers: [PrismaService, SharedDatasetsService],
  exports: [SharedDatasetsService],
})
export class SharedDatasetsModule {}
