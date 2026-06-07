import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GraphService } from '../graph.service';
import {
  ExpandGraphDto,
  GraphResponseDto,
  RebuildEdgesResponseDto,
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

  @Post('rebuild-edges')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rebuild all inferred edges from existing assets and findings',
  })
  @ApiResponse({ status: 200, type: RebuildEdgesResponseDto })
  async rebuildEdges(): Promise<RebuildEdgesResponseDto> {
    return this.graphService.rebuildEdges();
  }
}
