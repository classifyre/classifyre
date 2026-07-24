import { Global, Module } from '@nestjs/common';
import { PgBossService } from './pg-boss.service';
import { NamespaceJobConcurrencyService } from './namespace-job-concurrency.service';

@Global()
@Module({
  providers: [PgBossService, NamespaceJobConcurrencyService],
  exports: [PgBossService, NamespaceJobConcurrencyService],
})
export class PgBossModule {}
