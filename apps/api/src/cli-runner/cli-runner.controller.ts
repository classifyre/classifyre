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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { CliRunnerService } from './cli-runner.service';
import { RunnerStatus } from '@prisma/client';
import {
  StartRunnerDto,
  CreateExternalRunnerDto,
  ListRunnersQueryDto,
  RunnerDto,
  ListRunnersResponseDto,
  StopRunnerResponseDto,
  DeleteRunnerResponseDto,
  ListRunnerLogsQueryDto,
  RunnerLogsResponseDto,
} from './dto';
import { SearchRunnersRequestDto } from '../dto/search-runners-request.dto';
import { SearchRunnersResponseDto } from '../dto/search-runners-response.dto';
import { SearchRunnersChartsRequestDto } from '../dto/search-runners-charts-request.dto';
import { SearchRunnersChartsResponseDto } from '../dto/search-runners-charts-response.dto';

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

  @Patch('runners/:runnerId/status')
  @ApiOperation({ summary: 'Update runner status' })
  @ApiBody({
    schema: { properties: { status: { enum: ['COMPLETED', 'ERROR'] } } },
  })
  async updateRunnerStatus(
    @Param('runnerId') runnerId: string,
    @Body() body: { status: RunnerStatus },
  ) {
    return this.cliRunnerService.updateRunnerStatus(runnerId, body.status);
  }

  @Get('runners/:runnerId')
  @ApiOperation({ summary: 'Get runner status and details' })
  @ApiResponse({ status: 200, type: RunnerDto })
  getRunner(@Param('runnerId') runnerId: string) {
    return this.cliRunnerService.getRunnerStatus(runnerId);
  }

  @Get('runners/:runnerId/logs')
  @ApiOperation({
    summary:
      'Get paginated runner logs from filesystem storage (ordered oldest to newest)',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Byte cursor returned by previous page',
  })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiResponse({ status: 200, type: RunnerLogsResponseDto })
  async getRunnerLogs(
    @Param('runnerId') runnerId: string,
    @Query() query: ListRunnerLogsQueryDto,
  ) {
    return this.cliRunnerService.getRunnerLogs({
      runnerId,
      cursor: query.cursor,
      take: query.take,
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

@ApiTags('Runners')
@Controller('search')
export class SearchRunnersController {
  constructor(private cliRunnerService: CliRunnerService) {}

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
}
