import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataQueryModule } from '../data-query/data-query.module';
import { GovernanceModule } from '../governance/governance.module';
import { DataConnectionController } from './data-connection.controller';
import { DataConnectionService } from './data-connection.service';

/** SQL connections for BI tools and drivers (docs/prd/DQ-data-query.md §5.7). */
@Module({
  imports: [DataQueryModule, GovernanceModule],
  controllers: [DataConnectionController],
  providers: [PrismaService, DataConnectionService],
  exports: [DataConnectionService],
})
export class SqlConnectionsModule {}
