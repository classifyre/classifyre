import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { FindingsService } from './findings.service';
import { CreateFindingDto } from './dto/create-finding.dto';
import { UpdateFindingDto } from './dto/update-finding.dto';
import {
  BulkUpdateFindingsDto,
  BulkUpdateFindingsResponseDto,
} from './dto/bulk-update-findings.dto';
import { QueryFindingsAssetsDto } from './dto/query-findings-assets.dto';
import { FindingResponseDto } from './dto/finding-response.dto';
import { AssetFindingSummaryListResponseDto } from './dto/asset-finding-summary.dto';
import { QueryFindingsDiscoveryDto } from './dto/query-findings-discovery.dto';
import { FindingsDiscoveryResponseDto } from './dto/findings-discovery-response.dto';

@ApiTags('findings')
@Controller('findings')
export class FindingsController {
  constructor(private readonly findingsService: FindingsService) {}

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new finding' })
  @ApiResponse({
    status: 201,
    description: 'Finding created successfully',
    type: FindingResponseDto,
  })
  async create(@Body() createDto: CreateFindingDto) {
    return this.findingsService.create(createDto);
  }

  @Post('bulk-update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk update findings',
    description:
      'Update status, severity, and/or comment on multiple findings at once.',
  })
  @ApiBody({ type: BulkUpdateFindingsDto })
  @ApiResponse({
    status: 200,
    description: 'Findings updated successfully',
    type: BulkUpdateFindingsResponseDto,
  })
  async bulkUpdate(
    @Body() dto: BulkUpdateFindingsDto,
  ): Promise<BulkUpdateFindingsResponseDto> {
    return this.findingsService.bulkUpdate(dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get finding statistics' })
  @ApiQuery({ name: 'sourceId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Finding statistics' })
  async getStats(@Query('sourceId') sourceId?: string) {
    return this.findingsService.getStats(sourceId);
  }

  @Get('assets')
  @ApiOperation({
    summary: 'List asset finding summaries with optional filters',
  })
  @ApiResponse({
    status: 200,
    description: 'List of asset finding summaries',
    type: AssetFindingSummaryListResponseDto,
  })
  async listAssetSummaries(@Query() query: QueryFindingsAssetsDto) {
    return this.findingsService.listAssetSummaries(query);
  }

  @Get('discovery')
  @ApiOperation({ summary: 'Get discovery dashboard overview data' })
  @ApiResponse({
    status: 200,
    description: 'Discovery overview payload',
    type: FindingsDiscoveryResponseDto,
  })
  async getDiscoveryOverview(@Query() query: QueryFindingsDiscoveryDto) {
    return this.findingsService.getDiscoveryOverview(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a finding by ID' })
  @ApiResponse({
    status: 200,
    description: 'Finding found',
    type: FindingResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Finding not found' })
  async findOne(@Param('id') id: string) {
    const finding = await this.findingsService.findOne(id);
    if (!finding) {
      throw new NotFoundException(`Finding with ID ${id} not found`);
    }
    return finding;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a finding' })
  @ApiResponse({
    status: 200,
    description: 'Finding updated successfully',
    type: FindingResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Finding not found' })
  async update(@Param('id') id: string, @Body() updateDto: UpdateFindingDto) {
    return this.findingsService.update(id, updateDto);
  }
}
