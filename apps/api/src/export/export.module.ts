import { Module } from '@nestjs/common';
import { PgStreamService } from './pg-stream.service';
import { ExportQueryService } from './export-query.service';
import { LiveQueryService } from './live-query.service';
import { PrismaService } from '../prisma.service';

/**
 * Provides the streaming CSV export services and the cursor-paginated live-query
 * service. Imported by both AppModule (findings/assets) and CliRunnerModule
 * (runner-assets) so a single shared pg.Pool is reused across all export
 * endpoints.
 */
@Module({
  providers: [
    PgStreamService,
    ExportQueryService,
    LiveQueryService,
    PrismaService,
  ],
  exports: [PgStreamService, ExportQueryService, LiveQueryService],
})
export class ExportModule {}
