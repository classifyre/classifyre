import { Global, Module } from '@nestjs/common';
import { PgBossService } from './pg-boss.service';
import { NamespaceJobConcurrencyService } from './namespace-job-concurrency.service';
import { WorkerQueueRegistryService } from './worker-queue-registry.service';
import { WorkerLeadershipService } from './worker-leadership.service';

@Global()
@Module({
  providers: [
    PgBossService,
    NamespaceJobConcurrencyService,
    WorkerQueueRegistryService,
    WorkerLeadershipService,
  ],
  exports: [
    PgBossService,
    NamespaceJobConcurrencyService,
    WorkerQueueRegistryService,
    WorkerLeadershipService,
  ],
})
export class PgBossModule {}
