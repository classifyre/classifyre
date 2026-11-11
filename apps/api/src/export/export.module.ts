import { Module } from '@nestjs/common';
import { PgStreamService } from './pg-stream.service';
import { ExportQueryService } from './export-query.service';
import { PrismaService } from '../prisma.service';

/**
 * Provides the streaming CSV export services. Imported by both AppModule (findings/assets) and CliRunnerModule
 * (runner-assets) so a single shared pg.Pool is reused across all export
 * endpoints.
 */
@Module({
  providers: [PgStreamService, ExportQueryService, PrismaService],
  exports: [PgStreamService, ExportQueryService],
})
export class ExportModule {}
