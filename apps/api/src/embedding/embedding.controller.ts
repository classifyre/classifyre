import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmbeddingService } from './embedding.service';
import {
  MissingEmbeddingsDto,
  PutAssetChunksDto,
  PutEmbeddingVectorsDto,
  SimilarFindingsQueryDto,
} from './dto/embedding.dto';

@ApiTags('embeddings')
@Controller()
export class EmbeddingController {
  constructor(private readonly embeddings: EmbeddingService) {}

  @Get('embeddings/status')
  @ApiOperation({ summary: 'Get semantic storage and search capability' })
  status() {
    return this.embeddings.status();
  }

  @Post('sources/:sourceId/embeddings/missing')
  @ApiOperation({ summary: 'Negotiate missing content-addressed embeddings' })
  missing(
    @Param('sourceId') _sourceId: string,
    @Body() dto: MissingEmbeddingsDto,
  ) {
    return this.embeddings.missing(dto.space, dto.contentHashes);
  }

  @Post('sources/:sourceId/embeddings/vectors')
  @ApiOperation({ summary: 'Store normalized embedding vectors' })
  vectors(
    @Param('sourceId') _sourceId: string,
    @Body() dto: PutEmbeddingVectorsDto,
  ) {
    return this.embeddings.putVectors(dto);
  }

  @Post('sources/:sourceId/embeddings/chunks')
  @ApiOperation({ summary: 'Store asset chunk-to-content mappings' })
  chunks(@Param('sourceId') sourceId: string, @Body() dto: PutAssetChunksDto) {
    return this.embeddings.putChunks(sourceId, dto);
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
