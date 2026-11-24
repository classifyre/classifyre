import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DataQueryModule } from '../data-query/data-query.module';
import { SharedDatasetsModule } from '../shared-datasets/shared-datasets.module';
import { CaseActivityService } from '../case-activity.service';
import { CaseThreadsService } from '../case-threads.service';
import { DataRequestsController } from './data-requests.controller';
import { DataRequestsService } from './data-requests.service';
import { DataRequestNotifier } from './data-request.notifier';

@Module({
  imports: [DataQueryModule, SharedDatasetsModule],
  controllers: [DataRequestsController],
  providers: [
    PrismaService,
    DataRequestsService,
    DataRequestNotifier,
    CaseActivityService,
    CaseThreadsService,
  ],
  exports: [DataRequestsService, DataRequestNotifier],
})
export class DataRequestsModule {}
