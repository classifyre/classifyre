import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { EmbeddingController } from './embedding.controller';
import { EmbeddingCapabilityService } from './embedding-capability.service';
import { EmbeddingAnalysisService } from './embedding-analysis.service';
import { EmbeddingService } from './embedding.service';
import { QueryEmbeddingService } from './query-embedding.service';
import { EmbeddingConfigService } from './embedding-config.service';
import { EmbeddingProviderService } from './embedding-provider.service';
import { EmbeddingQueueService } from './embedding-queue.service';

/**
 * Shared semantic-embedding subsystem. A single module instance so every
 * consumer (REST search, MCP tools, autopilot agents) shares one provider
 * worker, one queue registration and one space binding — re-providing these
 * services elsewhere would boot a second inference worker per module.
 */
@Module({
  controllers: [EmbeddingController],
  providers: [
    PrismaService,
    EmbeddingConfigService,
    EmbeddingCapabilityService,
    EmbeddingAnalysisService,
    EmbeddingService,
    EmbeddingProviderService,
    EmbeddingQueueService,
    QueryEmbeddingService,
  ],
  exports: [
    EmbeddingConfigService,
    EmbeddingCapabilityService,
    EmbeddingAnalysisService,
    EmbeddingService,
    EmbeddingProviderService,
    EmbeddingQueueService,
    QueryEmbeddingService,
  ],
})
export class EmbeddingModule {}
