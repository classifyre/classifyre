import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AllowWhenPaused } from '../namespace/allow-when-paused.decorator';
import {
  MaintenanceService,
  type CleanupProgress,
  type CleanupRunStarted,
  type MaintenanceOverview,
} from './maintenance.service';

@ApiTags('maintenance')
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Workspace storage overview: per-table row estimates and byte sizes, grouped into protected and cleanable datasets',
  })
  @ApiResponse({ status: 200 })
  async overview(): Promise<MaintenanceOverview> {
    return this.maintenance.overview();
  }

  @Post('cleanup/:key')
  @AllowWhenPaused()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Start wiping one cleanable dataset in the background (scan history, duplicates, embeddings, harness runs, finished queue jobs, derived stats/graph, finished transfers). Protected data is never accepted here. Poll GET cleanup/runs/:runId for progress. Deliberately allowed while paused: freezing the workers first is the recommended quiet window (pause, clean, resume), since no writer can race the wipe.',
  })
  @ApiResponse({ status: 202, description: 'Cleanup run started' })
  @ApiResponse({
    status: 404,
    description: 'Unknown cleanup key (incl. protected datasets)',
  })
  startCleanup(@Param('key') key: string): CleanupRunStarted {
    return this.maintenance.startCleanup(key);
  }

  @Get('cleanup/runs/:runId')
  @ApiOperation({
    summary:
      'Poll one cleanup run: rows removed so far, current table, and the final result once done',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Unknown or expired run id' })
  cleanupRun(@Param('runId') runId: string): CleanupProgress {
    return this.maintenance.cleanupProgress(runId);
  }
}
