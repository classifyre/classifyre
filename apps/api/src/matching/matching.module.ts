import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { InquiryMatchingService } from './inquiry-matching.service';

/**
 * Background question-matching engine. Isolated from ingestion: it consumes a
 * pg-boss queue (PgBossModule is global) populated when a source finishes a run.
 * Exposes the service so InquiriesService can drive preview / rematch.
 */
@Module({
  providers: [InquiryMatchingService, PrismaService],
  exports: [InquiryMatchingService],
})
export class MatchingModule {}
