import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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

@ApiTags('embeddings')
@Controller()
export class EmbeddingController {
  constructor(
    private readonly embeddings: EmbeddingService,
    private readonly queue: EmbeddingQueueService,
  ) {}

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
  recalibrate(): EmbeddingRecalibrateResponseDto {
    this.queue.scheduleRecalibration();
    return { scheduled: true };
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
