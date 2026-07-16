import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmbeddingService } from './embedding.service';
import {
  PutAssetChunksDto,
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
  similar(
    @Param('findingId') findingId: string,
    @Query() query: SimilarFindingsQueryDto,
  ) {
    return this.embeddings.similarFindings(findingId, query.limit);
  }
}
