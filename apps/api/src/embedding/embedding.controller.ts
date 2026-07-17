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
  EmbeddingReindexResponseDto,
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
  status() {
    return { ...this.embeddings.status(), ...this.queue.status() };
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
    return this.embeddings.boilerplateClusters(
      sourceId,
      query.threshold,
      query.limit,
    );
  }
}
