import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AutopilotService } from './autopilot.service';
import {
  AgentRunDetailDto,
  AgentRunListResponseDto,
  QueryAgentRunsDto,
} from './dto/autopilot.dto';

@ApiTags('autopilot')
@Controller('autopilot')
export class AutopilotController {
  constructor(private readonly autopilot: AutopilotService) {}

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
}
