import { Module } from '@nestjs/common';

import { PrismaService } from '../prisma.service';
import { PgBossModule } from '../scheduler/pg-boss.module';
import { CorrelationModule } from '../correlation/correlation.module';
import { ArchiveStoreService } from './archive-store.service';
import { DataTransferController } from './data-transfer.controller';
import { DataTransferService } from './data-transfer.service';
import { DataTransferWorker } from './data-transfer.worker';
import { NamespaceExportService } from './namespace-export.service';
import { NamespaceImportService } from './namespace-import.service';

/**
 * Namespace export/import. Imported by AppModule for the REST surface and
 * exports the worker so NamespaceWorkerManager can register it per namespace.
 */
@Module({
  // CorrelationModule for the post-import value-index rebuild: after assets
  // or findings land, the import schedules the same catch-up that switching
  // Entities or Duplicates on schedules (see NamespaceImportService).
  imports: [PgBossModule, CorrelationModule],
  controllers: [DataTransferController],
  providers: [
    PrismaService,
    ArchiveStoreService,
    NamespaceExportService,
    NamespaceImportService,
    DataTransferService,
    DataTransferWorker,
  ],
  exports: [DataTransferWorker, DataTransferService, ArchiveStoreService],
})
export class DataTransferModule {}
