import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataQueryModule } from '../data-query/data-query.module';
import { GovernanceModule } from '../governance/governance.module';
import { AccessRequestsController } from './access-requests.controller';
import { AccessRequestsService } from './access-requests.service';

/** Asking for data access, decided by the data's owner (docs/prd/DQ §5.9). */
@Module({
  imports: [DataQueryModule, GovernanceModule],
  controllers: [AccessRequestsController],
  providers: [PrismaService, AccessRequestsService],
  exports: [AccessRequestsService],
})
export class AccessRequestsModule {}
