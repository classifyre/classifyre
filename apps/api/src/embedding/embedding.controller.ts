import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { EmbeddingService } from './embedding.service';
import {
  BoilerplateClusterDto,
  BoilerplateClustersQueryDto,
  EmbeddingRecalibrateResponseDto,
  EmbeddingReindexResponseDto,
  EmbeddingStatusResponseDto,
  GlobalBoilerplateClustersQueryDto,
  PutAssetChunksDto,
  SimilarFindingDto,
  SimilarFindingsQueryDto,
} from './dto/embedding.dto';
import { EmbeddingQueueService } from './embedding-queue.service';
import { InternalOnly } from '../internal-only.decorator';
import { AiProviderConfigService } from '../ai-provider-config.service';
import {
  EmbeddingSettingsService,
  SPACE_DEFINING_FIELDS,
  type ResolvedEmbeddingConfig,
} from './embedding-settings.service';
import { EmbeddingStatsService } from './embedding-stats.service';
import { EmbeddingRebuildService } from './embedding-rebuild.service';
import {
  EmbeddingRebuildResponseDto,
  EmbeddingSettingsResponseDto,
  EmbeddingSettingValueDto,
  UpdateEmbeddingSettingsDto,
  UpdateEmbeddingSettingsResponseDto,
} from './dto/embedding-settings.dto';

/**
 * Knobs the settings page exposes. Deliberately narrower than
 * ResolvedEmbeddingConfig: cacheDir, localModelPath and the queue-internal
 * pacing values are deployment concerns (a path inside a container, a pg-boss
 * fetch-size trade-off) that no workspace should be retuning from a browser.
 */
const EXPOSED_FIELDS = [
  'enabled',
  'provider',
  'model',
  'revision',
  'dimensions',
  'pooling',
  'normalize',
  'batchSize',
  'workerConcurrency',
  'maxParallelCalls',
  'intraOpThreads',
  'dtype',
  'device',
  'autoBackfill',
  'hnswM',
  'hnswEfConstruction',
  'hnswEfSearch',
] as const satisfies readonly (keyof ResolvedEmbeddingConfig)[];

@ApiTags('embeddings')
@Controller()
export class EmbeddingController {
  constructor(
    private readonly embeddings: EmbeddingService,
    private readonly queue: EmbeddingQueueService,
    private readonly settings: EmbeddingSettingsService,
    private readonly stats: EmbeddingStatsService,
    private readonly rebuilds: EmbeddingRebuildService,
    private readonly aiProviders: AiProviderConfigService,
  ) {}

  @Get('embeddings/settings')
  @ApiOperation({
    summary:
      'Embedding configuration for this workspace, the deployment defaults behind it, and corpus size',
  })
  @ApiOkResponse({ type: EmbeddingSettingsResponseDto })
  async getSettings(): Promise<EmbeddingSettingsResponseDto> {
    return this.describeSettings();
  }

  @Put('embeddings/settings')
  @ApiOperation({
    summary:
      'Change embedding configuration; redefining the vector space purges the corpus and re-embeds it',
  })
  @ApiOkResponse({ type: UpdateEmbeddingSettingsResponseDto })
  async updateSettings(
    @Body() dto: UpdateEmbeddingSettingsDto,
  ): Promise<UpdateEmbeddingSettingsResponseDto> {
    const { requiresRebuild, changedFields } = await this.settings.update(dto);

    // Started here rather than left to the operator: a workspace whose stored
    // vectors no longer match its configuration would keep answering searches
    // with distances that mean nothing. There is no useful state between the
    // two configurations, so the change and the rebuild are one action.
    let rebuildStarted = false;
    if (requiresRebuild) {
      rebuildStarted = this.rebuilds.start(
        `Configuration changed: ${changedFields.join(', ')}`,
      ).started;
    }

    return {
      settings: await this.describeSettings(),
      rebuildStarted,
      changedFields,
    };
  }

  @Post('embeddings/rebuild')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Purge every stored vector for this workspace and re-embed the corpus from scratch',
  })
  @ApiAcceptedResponse({ type: EmbeddingRebuildResponseDto })
  rebuild(): EmbeddingRebuildResponseDto {
    return this.rebuilds.start('Requested from the settings page');
  }

  private async describeSettings(): Promise<EmbeddingSettingsResponseDto> {
    const [effective, overrides, providers] = await Promise.all([
      this.settings.resolve(),
      this.settings.overrides(),
      this.aiProviders.list().catch(() => []),
    ]);
    const defaults = this.settings.deploymentDefaults();
    const space = effective.enabled
      ? await this.embeddings.configuredSpace().catch(() => null)
      : null;
    const stats = await this.stats.collect(space?.id);

    const fields: Record<string, EmbeddingSettingValueDto> = {};
    for (const field of EXPOSED_FIELDS) {
      fields[field] = {
        value: effective[field],
        deploymentDefault: defaults[field],
        overridden:
          overrides != null &&
          (overrides as Record<string, unknown>)[field] !== null &&
          (overrides as Record<string, unknown>)[field] !== undefined,
      };
    }

    return {
      enabled: effective.enabled,
      provider: effective.provider,
      model: effective.model,
      revision: effective.revision,
      dimensions: effective.dimensions,
      pooling: effective.pooling,
      normalize: effective.normalize,
      batchSize: effective.batchSize,
      workerConcurrency: effective.workerConcurrency,
      maxParallelCalls: effective.maxParallelCalls,
      intraOpThreads: effective.intraOpThreads,
      dtype: effective.dtype,
      device: effective.device,
      autoBackfill: effective.autoBackfill,
      hnswM: effective.hnswM,
      hnswEfConstruction: effective.hnswEfConstruction,
      hnswEfSearch: effective.hnswEfSearch,
      aiProviderConfigId: effective.aiProviderConfigId ?? null,
      allowRemoteModels: effective.allowRemoteModels,
      fields,
      // Only providers marked as serving embeddings. Chat completions and
      // embeddings are separate endpoints with separate model names, so
      // offering every saved provider here would mostly offer choices that
      // fail on the first batch. The currently bound provider is kept in the
      // list even if the flag was cleared later, so the page can still show
      // what is in force rather than rendering an empty selector.
      aiProviders: providers
        .filter(
          (provider) =>
            provider.supportsEmbedding ||
            provider.id === effective.aiProviderConfigId,
        )
        .map((provider) => ({
          id: provider.id,
          name: provider.name,
          provider: provider.provider,
          baseUrl: provider.baseUrl ?? null,
          hasApiKey: provider.hasApiKey,
          supportsEmbedding: provider.supportsEmbedding,
        })),
      rebuildTriggerFields: [...SPACE_DEFINING_FIELDS, 'enabled'],
      stats,
      rebuildRunning: this.rebuilds.isRunning(),
      rebuildStartedAt: overrides?.rebuildStartedAt?.toISOString() ?? null,
      rebuildCompletedAt: overrides?.rebuildCompletedAt?.toISOString() ?? null,
      rebuildError: overrides?.rebuildError ?? null,
      rebuildReason: overrides?.rebuildReason ?? null,
    };
  }

  @Get('embeddings/status')
  @ApiOperation({ summary: 'Get semantic storage and search capability' })
  @ApiOkResponse({ type: EmbeddingStatusResponseDto })
  async status() {
    return { ...this.embeddings.status(), ...(await this.queue.status()) };
  }

  @Post('embeddings/reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Reconcile stored findings and asset chunks into the configured embedding space',
  })
  @ApiAcceptedResponse({ type: EmbeddingReindexResponseDto })
  reindex(): EmbeddingReindexResponseDto {
    return this.queue.requestBackfill();
  }

  @InternalOnly()
  @Post('sources/:sourceId/embeddings/chunks')
  @ApiOperation({ summary: 'Store asset chunk-to-content mappings' })
  async chunks(
    @Param('sourceId') sourceId: string,
    @Body() dto: PutAssetChunksDto,
  ) {
    const result = await this.embeddings.putChunks(sourceId, dto);
    this.queue.enqueue(result.contents);
    return { stored: result.stored, queued: result.contents.length };
  }

  @Get('findings/:findingId/similar')
  @ApiOperation({
    summary: 'Find semantically similar findings with ranking evidence',
  })
  @ApiOkResponse({ type: [SimilarFindingDto] })
  similar(
    @Param('findingId') findingId: string,
    @Query() query: SimilarFindingsQueryDto,
  ) {
    return this.embeddings.similarFindings(findingId, query.limit);
  }

  @Get('embeddings/boilerplate-clusters')
  @ApiOperation({
    summary:
      'Near-duplicate finding clusters across the corpus, optionally filtered to specific sources',
  })
  @ApiOkResponse({ type: [BoilerplateClusterDto] })
  boilerplateGlobal(@Query() query: GlobalBoilerplateClustersQueryDto) {
    return this.embeddings.boilerplateClusters({
      sourceIds:
        typeof query.sourceIds === 'string'
          ? [query.sourceIds]
          : query.sourceIds,
      threshold: query.threshold,
      limit: query.limit,
    });
  }

  @Post('embeddings/recalibrate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Schedule a full evidence-ranking recalibration pass (importance scores, outliers, near-duplicate groups)',
  })
  @ApiAcceptedResponse({ type: EmbeddingRecalibrateResponseDto })
  async recalibrate(): Promise<EmbeddingRecalibrateResponseDto> {
    return { scheduled: await this.queue.scheduleRecalibration() };
  }

  @Get('sources/:sourceId/boilerplate-clusters')
  @ApiOperation({
    summary:
      'Near-duplicate finding clusters in a source (repeated boilerplate)',
  })
  @ApiOkResponse({ type: [BoilerplateClusterDto] })
  boilerplate(
    @Param('sourceId') sourceId: string,
    @Query() query: BoilerplateClustersQueryDto,
  ) {
    return this.embeddings.boilerplateClusters({
      sourceIds: [sourceId],
      threshold: query.threshold,
      limit: query.limit,
    });
  }
}
