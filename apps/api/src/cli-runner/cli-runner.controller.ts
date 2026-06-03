import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  Patch,
  HttpCode,
  HttpStatus,
  UseGuards,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBody,
  ApiResponse,
  ApiProduces,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { PgStreamService } from '../export/pg-stream.service';
import { ExportQueryService } from '../export/export-query.service';
import { LiveQueryService } from '../export/live-query.service';
import {
  ExportRunnerAssetsQueryDto,
  LiveQueryResponseDto,
} from '../dto/export-query.dto';
import { CliRunnerService } from './cli-runner.service';
import { RunnerStatus } from '@prisma/client';
import { AllowInDemoMode } from '../demo-mode.decorator';
import { CliBackpressureGuard } from '../guards/cli-backpressure.guard';
import {
  StartRunnerDto,
  CreateExternalRunnerDto,
  ListRunnersQueryDto,
  RunnerDto,
  ListRunnersResponseDto,
  StopRunnerResponseDto,
  DeleteRunnerResponseDto,
  SearchRunnerLogsBodyDto,
  RunnerLogsResponseDto,
  RegisterDiscoveredAssetsDto,
  RegisterDiscoveredAssetsResponseDto,
  UpdateRunnerAssetStatusDto,
  RunnerAssetProgressDto,
} from './dto';
import { SearchRunnersRequestDto } from '../dto/search-runners-request.dto';
import { SearchRunnersResponseDto } from '../dto/search-runners-response.dto';
import { SearchRunnersChartsRequestDto } from '../dto/search-runners-charts-request.dto';
import { SearchRunnersChartsResponseDto } from '../dto/search-runners-charts-response.dto';
import { SearchRunnersAssetsRequestDto } from '../dto/search-runners-assets-request.dto';
import { SearchRunnersAssetsResponseDto } from '../dto/search-runners-assets-response.dto';

@ApiTags('Runners')
@Controller()
export class CliRunnerController {
  constructor(private cliRunnerService: CliRunnerService) {}

  @Post('sources/:sourceId/run')
  @ApiOperation({ summary: 'Start CLI runner for source' })
  @ApiBody({ type: StartRunnerDto, required: false })
  @ApiResponse({
    status: 201,
    type: RunnerDto,
    description: 'Runner started successfully',
  })
  async startRunner(
    @Param('sourceId') sourceId: string,
    @Body() dto?: StartRunnerDto,
  ) {
    return this.cliRunnerService.startRun(
      sourceId,
      dto?.triggerType,
      dto?.triggeredBy,
    );
  }

  @UseGuards(CliBackpressureGuard)
  @Post('sources/:sourceId/runners/external')
  @ApiOperation({
    summary: 'Create runner record for external CLI REST ingestion',
  })
  @ApiBody({ type: CreateExternalRunnerDto, required: false })
  @ApiResponse({
    status: 201,
    type: RunnerDto,
    description: 'External runner created successfully',
  })
  async createExternalRunner(
    @Param('sourceId') sourceId: string,
    @Body() dto?: CreateExternalRunnerDto,
  ) {
    return this.cliRunnerService.createExternalRunner(
      sourceId,
      dto?.triggeredBy,
    );
  }

  @Patch('runners/:runnerId/stop')
  @ApiOperation({ summary: 'Stop running CLI process' })
  @ApiResponse({ status: 200, type: StopRunnerResponseDto })
  async stopRunner(@Param('runnerId') runnerId: string) {
    return this.cliRunnerService.stopRunner(runnerId);
  }

  @Delete('runners/:runnerId')
  @ApiOperation({
    summary:
      'Delete runner metadata and cleanup filesystem logs for this runner',
  })
  @ApiResponse({ status: 200, type: DeleteRunnerResponseDto })
  async deleteRunner(@Param('runnerId') runnerId: string) {
    return this.cliRunnerService.deleteRunner(runnerId);
  }

  @UseGuards(CliBackpressureGuard)
  @AllowInDemoMode()
  @Patch('runners/:runnerId/status')
  @ApiOperation({ summary: 'Update runner status' })
  @ApiBody({
    schema: {
      properties: {
        status: { enum: ['COMPLETED', 'ERROR'] },
        errorMessage: { type: 'string' },
      },
    },
  })
  async updateRunnerStatus(
    @Param('runnerId') runnerId: string,
    @Body() body: { status: RunnerStatus; errorMessage?: string },
  ) {
    return this.cliRunnerService.updateRunnerStatus(
      runnerId,
      body.status,
      body.errorMessage,
    );
  }

  @UseGuards(CliBackpressureGuard)
  @Post('runners/:runnerId/assets/discover')
  @ApiOperation({ summary: 'Register discovered asset hashes for a runner' })
  @ApiBody({ type: RegisterDiscoveredAssetsDto })
  @ApiResponse({ status: 201, type: RegisterDiscoveredAssetsResponseDto })
  async registerDiscoveredAssets(
    @Param('runnerId') runnerId: string,
    @Body() dto: RegisterDiscoveredAssetsDto,
  ) {
    return this.cliRunnerService.registerDiscoveredAssets(
      runnerId,
      dto.assetHashes,
    );
  }

  @UseGuards(CliBackpressureGuard)
  @Patch('runners/:runnerId/assets/status')
  @ApiOperation({ summary: 'Update processing status of runner assets' })
  @ApiBody({ type: UpdateRunnerAssetStatusDto })
  @ApiResponse({ status: 200 })
  async updateRunnerAssetStatuses(
    @Param('runnerId') runnerId: string,
    @Body() dto: UpdateRunnerAssetStatusDto,
  ) {
    await this.cliRunnerService.updateRunnerAssetStatuses(runnerId, dto.assets);
    return { updated: dto.assets.length };
  }

  @AllowInDemoMode()
  @Get('runners/:runnerId/assets/progress')
  @ApiOperation({ summary: 'Get runner asset processing progress' })
  @ApiResponse({ status: 200, type: RunnerAssetProgressDto })
  async getRunnerAssetProgress(@Param('runnerId') runnerId: string) {
    return this.cliRunnerService.getRunnerAssetProgress(runnerId);
  }

  @Get('runners/:runnerId')
  @ApiOperation({ summary: 'Get runner status and details' })
  @ApiResponse({ status: 200, type: RunnerDto })
  getRunner(@Param('runnerId') runnerId: string) {
    return this.cliRunnerService.getRunnerStatus(runnerId);
  }

  @Post('runners/:runnerId/logs')
  @ApiOperation({
    summary:
      'Search runner logs with server-side filtering, full-text search, and sort',
  })
  @ApiBody({ type: SearchRunnerLogsBodyDto })
  @ApiResponse({ status: 200, type: RunnerLogsResponseDto })
  async searchRunnerLogs(
    @Param('runnerId') runnerId: string,
    @Body() body: SearchRunnerLogsBodyDto,
  ) {
    return this.cliRunnerService.getRunnerLogs({
      runnerId,
      cursor: body.cursor,
      take: body.take,
      search: body.search,
      levels: body.levels,
      sortOrder: body.sortOrder,
      streams: body.streams,
    });
  }

  @Get('sources/:sourceId/runners')
  @ApiOperation({ summary: 'List runners for source' })
  @ApiQuery({ name: 'status', required: false, enum: RunnerStatus })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiResponse({ status: 200, type: ListRunnersResponseDto })
  async listSourceRunners(
    @Param('sourceId') sourceId: string,
    @Query() query: ListRunnersQueryDto,
  ) {
    return this.cliRunnerService.listRunners({
      sourceId,
      ...query,
    });
  }

  @Get('runners')
  @ApiOperation({ summary: 'List all runners' })
  @ApiQuery({ name: 'sourceId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: RunnerStatus })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiResponse({ status: 200, type: ListRunnersResponseDto })
  async listRunners(@Query() query: ListRunnersQueryDto) {
    return this.cliRunnerService.listRunners(query);
  }
}

@AllowInDemoMode()
@ApiTags('Runners')
@Controller('search')
export class SearchRunnersController {
  constructor(
    private cliRunnerService: CliRunnerService,
    private readonly pgStreamService: PgStreamService,
    private readonly exportQueryService: ExportQueryService,
    private readonly liveQueryService: LiveQueryService,
  ) {}

  @Get('runner-assets/query')
  @ApiOperation({
    summary: 'Query runner assets (cursor-paginated JSON)',
    description:
      'Returns a page of runner_assets rows as JSON for live consumption (e.g. Excel Power Query). Follow `nextCursor` to page through the full result set.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size (default 1000, max 10000)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque cursor from a previous page',
  })
  @ApiResponse({ status: 200, type: LiveQueryResponseDto })
  async queryRunnerAssets(
    @Query() query: ExportRunnerAssetsQueryDto,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<LiveQueryResponseDto> {
    return this.liveQueryService.queryRunnerAssets(query, { limit, cursor });
  }

  @Get('runner-assets/export')
  @ApiOperation({
    summary: 'Export runner assets as CSV',
    description:
      'Streams runner_assets rows for a runner matching the current filters as a CSV download.',
  })
  @ApiProduces('text/csv')
  @ApiResponse({
    status: 200,
    description: 'CSV stream of runner assets',
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  })
  async exportRunnerAssets(
    @Query() query: ExportRunnerAssetsQueryDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.pgStreamService.streamCsv(
      reply,
      this.exportQueryService.buildRunnerAssetsQuery(query),
    );
  }

  @Post('runners')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search runners',
    description:
      'Search paginated runners with nested body filters and server-side sorting.',
  })
  @ApiBody({ type: SearchRunnersRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Search results containing runners',
    type: SearchRunnersResponseDto,
  })
  async searchRunners(
    @Body() request: SearchRunnersRequestDto,
  ): Promise<SearchRunnersResponseDto> {
    return this.cliRunnerService.searchRunners(request);
  }

  @Post('runners/charts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Runners charts overview',
    description:
      'Returns totals, status timeline, and top sources for runners in a single response.',
  })
  @ApiBody({ type: SearchRunnersChartsRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Chart overview containing totals, timeline and top sources',
    type: SearchRunnersChartsResponseDto,
  })
  async searchRunnersCharts(
    @Body() request: SearchRunnersChartsRequestDto,
  ): Promise<SearchRunnersChartsResponseDto> {
    return this.cliRunnerService.searchRunnersCharts(request);
  }

  @Post('runner-assets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search runner assets',
    description:
      'Returns paginated runner_assets rows for a specific runner, joined with the resolved asset record and its findings.',
  })
  @ApiBody({ type: SearchRunnersAssetsRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Paginated runner assets with joined asset and findings data',
    type: SearchRunnersAssetsResponseDto,
  })
  async searchRunnerAssets(
    @Body() request: SearchRunnersAssetsRequestDto,
  ): Promise<SearchRunnersAssetsResponseDto> {
    return this.cliRunnerService.searchRunnerAssets(request);
  }
}
