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
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AutopilotService } from './autopilot.service';
import {
  AgentActivityListResponseDto,
  AgentLogListResponseDto,
  AgentMemoryDto,
  AgentMemoryListResponseDto,
  AgentRunDetailDto,
  AgentRunDto,
  AgentRunListResponseDto,
  AgentSystemBriefDto,
  AutopilotStatsDto,
  CreateAgentMemoryDto,
  HarnessToolsResponseDto,
  UpdateSystemBriefDto,
  QueryAgentActivityDto,
  QueryAgentLogsDto,
  QueryAgentMemoryDto,
  QueryAgentRunsDto,
  TriggerAutopilotDto,
  TriggerAutopilotResponseDto,
  UpdateAgentMemoryDto,
} from './dto/autopilot.dto';

@ApiTags('autopilot')
@Controller('autopilot')
export class AutopilotController {
  constructor(private readonly autopilot: AutopilotService) {}

  @Post('trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Manually trigger an autopilot cycle over existing data, with an optional steering instruction',
  })
  @ApiResponse({ status: 202, type: TriggerAutopilotResponseDto })
  trigger(
    @Body() dto: TriggerAutopilotDto,
  ): Promise<TriggerAutopilotResponseDto> {
    return this.autopilot.trigger(dto);
  }

  @Post('dream')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Trigger a dream cycle now (memory consolidation — dedupe, prune noise, distill notes)',
  })
  @ApiResponse({ status: 202, type: TriggerAutopilotResponseDto })
  triggerDream(): Promise<TriggerAutopilotResponseDto> {
    return this.autopilot.triggerDream();
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Mission-control counters (runs, decisions, memory, brief version)',
  })
  @ApiResponse({ status: 200, type: AutopilotStatsDto })
  getStats(): Promise<AutopilotStatsDto> {
    return this.autopilot.getStats();
  }

  @Get('activity')
  @ApiOperation({
    summary:
      'Cross-run activity feed (the business timeline) — server-side filter by kind, action, outcome, entity, text and time',
  })
  @ApiResponse({ status: 200, type: AgentActivityListResponseDto })
  listActivity(
    @Query() query: QueryAgentActivityDto,
  ): Promise<AgentActivityListResponseDto> {
    return this.autopilot.listActivity(query);
  }

  @Get('tools')
  @ApiOperation({
    summary:
      'The harness capability map — every registered tool (read/mutate, domain) and the missions that use them',
  })
  @ApiResponse({ status: 200, type: HarnessToolsResponseDto })
  getTools(): HarnessToolsResponseDto {
    return this.autopilot.getTools();
  }

  @Get('system-brief')
  @ApiOperation({
    summary: 'The living system brief the autopilot maintains and injects',
  })
  @ApiResponse({ status: 200, type: AgentSystemBriefDto })
  getSystemBrief(): Promise<AgentSystemBriefDto> {
    return this.autopilot.getSystemBrief();
  }

  @Put('system-brief')
  @ApiOperation({ summary: 'Create or rewrite the system-brief narrative' })
  @ApiResponse({ status: 200, type: AgentSystemBriefDto })
  updateSystemBrief(
    @Body() dto: UpdateSystemBriefDto,
  ): Promise<AgentSystemBriefDto> {
    return this.autopilot.updateSystemBrief(dto.content);
  }

  @Get('runs')
  @ApiOperation({ summary: 'List autopilot agent runs (newest first)' })
  @ApiResponse({ status: 200, type: AgentRunListResponseDto })
  listRuns(
    @Query() query: QueryAgentRunsDto,
  ): Promise<AgentRunListResponseDto> {
    return this.autopilot.listRuns(query);
  }

  @Get('runs/:id')
  @ApiOperation({
    summary: 'Get one autopilot run with all decisions and rationales',
  })
  @ApiResponse({ status: 200, type: AgentRunDetailDto })
  getRun(@Param('id') id: string): Promise<AgentRunDetailDto> {
    return this.autopilot.getRun(id);
  }

  @Post('runs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Stop a pending/running agent run (it aborts before its next step)',
  })
  @ApiResponse({ status: 200, type: AgentRunDto })
  cancelRun(@Param('id') id: string): Promise<AgentRunDto> {
    return this.autopilot.cancelRun(id);
  }

  @Post('runs/:id/rerun')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Re-execute one specific agent run from scratch under its original cycle identity',
  })
  @ApiResponse({ status: 202, type: TriggerAutopilotResponseDto })
  rerunRun(@Param('id') id: string): Promise<TriggerAutopilotResponseDto> {
    return this.autopilot.rerunRun(id);
  }

  @Get('runs/:id/logs')
  @ApiOperation({
    summary:
      'Execution log of a run — filter by channel (BUSINESS narrative vs TECHNICAL mechanics/raw model output)',
  })
  @ApiResponse({ status: 200, type: AgentLogListResponseDto })
  listLogs(
    @Param('id') id: string,
    @Query() query: QueryAgentLogsDto,
  ): Promise<AgentLogListResponseDto> {
    return this.autopilot.listLogs(id, query);
  }

  @Get('memory')
  @ApiOperation({
    summary: 'List the agent memory (glossary, precedents, topic map)',
  })
  @ApiResponse({ status: 200, type: AgentMemoryListResponseDto })
  listMemory(
    @Query() query: QueryAgentMemoryDto,
  ): Promise<AgentMemoryListResponseDto> {
    return this.autopilot.listMemory(query);
  }

  @Post('memory')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add (or overwrite) a memory entry to steer the agent',
  })
  @ApiResponse({ status: 201, type: AgentMemoryDto })
  createMemory(@Body() dto: CreateAgentMemoryDto): Promise<AgentMemoryDto> {
    return this.autopilot.createMemory(dto);
  }

  @Patch('memory/:id')
  @ApiOperation({ summary: 'Edit a memory entry (content, tags, weight)' })
  @ApiResponse({ status: 200, type: AgentMemoryDto })
  updateMemory(
    @Param('id') id: string,
    @Body() dto: UpdateAgentMemoryDto,
  ): Promise<AgentMemoryDto> {
    return this.autopilot.updateMemory(id, dto);
  }

  @Delete('memory/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a memory entry the agent learned' })
  async deleteMemory(@Param('id') id: string): Promise<void> {
    await this.autopilot.deleteMemory(id);
  }
}
