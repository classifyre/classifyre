import { Global, Module } from '@nestjs/common';
import { PgBossService } from './pg-boss.service';
import { NamespaceJobConcurrencyService } from './namespace-job-concurrency.service';
import { WorkerQueueRegistryService } from './worker-queue-registry.service';

@Global()
@Module({
  providers: [
    PgBossService,
    NamespaceJobConcurrencyService,
    WorkerQueueRegistryService,
  ],
  exports: [
    PgBossService,
    NamespaceJobConcurrencyService,
    WorkerQueueRegistryService,
  ],
})
export class PgBossModule {}
