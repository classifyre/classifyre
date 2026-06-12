import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GraphService } from '../graph.service';
import {
  BulkIngestEdgesDto,
  BulkIngestEdgesResponseDto,
  CreateManualEdgeDto,
  EdgeDetailDto,
  ExpandGraphDto,
  GraphResponseDto,
  PivotGraphDto,
  RebuildEdgesResponseDto,
  RelationTypesResponseDto,
  UpdateEdgeDto,
} from '../dto/graph.dto';

@ApiTags('graph')
@Controller('graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Post('expand')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Expand the graph around a seed entity (recursive traversal)',
  })
  @ApiResponse({ status: 200, type: GraphResponseDto })
  async expand(@Body() dto: ExpandGraphDto): Promise<GraphResponseDto> {
    return this.graphService.expand(dto);
  }

  @Post('pivot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Named pivot question on a node (e.g. who_touched, upstream_lineage, emails)',
  })
  @ApiResponse({ status: 200, type: GraphResponseDto })
  async pivot(@Body() dto: PivotGraphDto): Promise<GraphResponseDto> {
    return this.graphService.pivot(dto);
  }

  @Post('edges')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk-upsert source-derived edges from a connector. Idempotent.',
  })
  @ApiResponse({ status: 200, type: BulkIngestEdgesResponseDto })
  async ingestEdges(
    @Body() dto: BulkIngestEdgesDto,
  ): Promise<BulkIngestEdgesResponseDto> {
    return this.graphService.upsertEdges(dto);
  }

  @Post('rebuild-edges')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rebuild all inferred edges from existing assets and findings',
  })
  @ApiResponse({ status: 200, type: RebuildEdgesResponseDto })
  async rebuildEdges(): Promise<RebuildEdgesResponseDto> {
    return this.graphService.rebuildEdges();
  }

  @Get('relation-types')
  @ApiOperation({
    summary: 'Get all relation types in use + vocabulary suggestions',
  })
  @ApiResponse({ status: 200, type: RelationTypesResponseDto })
  async relationTypes(): Promise<RelationTypesResponseDto> {
    return this.graphService.getRelationTypes();
  }

  @Post('edges/manual')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Create a manual edge between two entities (user-defined relation type)',
  })
  @ApiResponse({ status: 200, type: EdgeDetailDto })
  async createManualEdge(
    @Body() dto: CreateManualEdgeDto,
  ): Promise<EdgeDetailDto> {
    return this.graphService.createManualEdge(dto);
  }

  @Patch('edges/:id')
  @ApiOperation({ summary: 'Rename an edge relation type' })
  @ApiResponse({ status: 200, type: EdgeDetailDto })
  async updateEdge(
    @Param('id') id: string,
    @Body() dto: UpdateEdgeDto,
  ): Promise<EdgeDetailDto> {
    return this.graphService.updateEdge(id, dto);
  }

  @Delete('edges/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an edge' })
  async deleteEdge(@Param('id') id: string): Promise<void> {
    return this.graphService.deleteEdge(id);
  }
}
