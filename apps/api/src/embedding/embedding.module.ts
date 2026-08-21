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
import { EmbeddingSettingsService } from './embedding-settings.service';
import { EmbeddingStatsService } from './embedding-stats.service';
import { EmbeddingRebuildService } from './embedding-rebuild.service';
import { AiProviderConfigService } from '../ai-provider-config.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';

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
    EmbeddingSettingsService,
    EmbeddingStatsService,
    EmbeddingRebuildService,
    // Re-provided rather than imported: AiProviderConfigService is a leaf
    // service several modules construct for themselves (see cli-runner and
    // autopilot), and importing AppModule here would be a cycle.
    AiProviderConfigService,
    MaskedConfigCryptoService,
    EmbeddingCapabilityService,
    EmbeddingAnalysisService,
    EmbeddingService,
    EmbeddingProviderService,
    EmbeddingQueueService,
    QueryEmbeddingService,
  ],
  exports: [
    EmbeddingConfigService,
    EmbeddingSettingsService,
    EmbeddingStatsService,
    EmbeddingRebuildService,
    EmbeddingCapabilityService,
    EmbeddingAnalysisService,
    EmbeddingService,
    EmbeddingProviderService,
    EmbeddingQueueService,
    QueryEmbeddingService,
  ],
})
export class EmbeddingModule {}
