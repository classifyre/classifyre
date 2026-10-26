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
  ColumnLineageDto,
  ColumnLineageResponseDto,
  CreateManualEdgeDto,
  EdgeDetailDto,
  ExpandGraphDto,
  GraphResponseDto,
  LineageGraphDto,
  PivotGraphDto,
  RebuildEdgesResponseDto,
  RelationTypesResponseDto,
  UpdateEdgeDto,
} from '../dto/graph.dto';
import { InternalOnly } from '../internal-only.decorator';
import { AllowInDemoMode } from '../demo-mode.decorator';
import { ReadOnlyEndpoint } from '../db/read-only-endpoint.decorator';

@ApiTags('graph')
@Controller('graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @AllowInDemoMode()
  @ReadOnlyEndpoint()
  @Post('lineage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trace where an asset came from, or what breaks if it changes',
    description:
      'Walks every edge class, so a connector-declared SAME_AS or REFERENCE ' +
      'is visible here rather than silently dropped. Containment and identity ' +
      'are also controls: collapseContainers rolls tables up into their ' +
      'schemas, and mergeIdentity folds an asset and its twin in another ' +
      'system into one node so a path across them costs one hop instead of ' +
      'two. Note this is deliberately broader than the derivation test the ' +
      'duplicate-review queue uses — see DERIVATION_CLASSES in graph/edge-class.ts, ' +
      "which excludes the correlation engine's own edges so that similarity " +
      'cannot be used as evidence about similarity.',
  })
  @ApiResponse({ status: 200, type: GraphResponseDto })
  async lineage(@Body() dto: LineageGraphDto): Promise<GraphResponseDto> {
    return this.graphService.lineage(dto);
  }

  @AllowInDemoMode()
  @ReadOnlyEndpoint()
  @Post('lineage/column')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Trace one column back through the transformations that produced it',
    description:
      'Indirect dependencies — an ORDER BY or a join key that shaped which rows ' +
      'came out without feeding the value — are returned separately, so they do ' +
      'not read as if the column was computed from them.',
  })
  @ApiResponse({ status: 200, type: ColumnLineageResponseDto })
  async columnLineage(
    @Body() dto: ColumnLineageDto,
  ): Promise<ColumnLineageResponseDto> {
    return this.graphService.columnLineage(dto);
  }

  @AllowInDemoMode()
  @Post('expand')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Expand the graph around a seed entity (recursive traversal)',
  })
  @ApiResponse({ status: 200, type: GraphResponseDto })
  async expand(@Body() dto: ExpandGraphDto): Promise<GraphResponseDto> {
    return this.graphService.expand(dto);
  }

  @AllowInDemoMode()
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

  @InternalOnly()
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
