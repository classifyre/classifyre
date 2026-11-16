import { Module } from '@nestjs/common';
import { CliRunnerModule } from '../cli-runner/cli-runner.module';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { PrismaService } from '../prisma.service';
import { DataQueryController } from './data-query.controller';
import { QueryCatalogService } from './query-catalog.service';
import { QueryRunService } from './query-run.service';
import { SavedQueriesService } from './saved-queries.service';
import { SharedDatasetResolver } from './shared-dataset-resolver';

/** SQL over the tables of a workspace (docs/prd/DQ-data-query.md). */
@Module({
  imports: [CliRunnerModule],
  controllers: [DataQueryController],
  providers: [
    PrismaService,
    MaskedConfigCryptoService,
    QueryCatalogService,
    QueryRunService,
    SavedQueriesService,
    SharedDatasetResolver,
  ],
  exports: [
    QueryCatalogService,
    QueryRunService,
    SavedQueriesService,
    SharedDatasetResolver,
  ],
})
export class DataQueryModule {}
