import { Module } from '@nestjs/common';

import { PrismaService } from '../prisma.service';
import { PgBossModule } from '../scheduler/pg-boss.module';
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
  imports: [PgBossModule],
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
