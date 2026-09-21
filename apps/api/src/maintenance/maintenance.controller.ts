import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AllowWhenPaused } from '../namespace/allow-when-paused.decorator';
import {
  MaintenanceService,
  type CleanupProgress,
  type CleanupRunStarted,
  type MaintenanceOverview,
} from './maintenance.service';
import {
  WorkspaceFeaturesService,
  type SetWorkspaceFeatureResult,
  type WorkspaceFeaturesOverview,
} from './workspace-features.service';

@ApiTags('maintenance')
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly features: WorkspaceFeaturesService,
  ) {}

  @Get('features')
  @ApiOperation({
    summary:
      'Workspace feature switches (embeddings, duplicate detection): state, how each was turned off, the data each owns and the queues held while off',
  })
  @ApiResponse({ status: 200 })
  listFeatures(): Promise<WorkspaceFeaturesOverview> {
    return this.features.list();
  }

  @Put('features/:key')
  @AllowWhenPaused()
  @ApiOperation({
    summary:
      'Turn a workspace feature on or off. Off holds its worker queues paused (every replica stops; the Workers tab cannot resume them) and either keeps its data (a pause — turning back on catches up) or, with deleteData, wipes it in the background (poll GET cleanup/runs/:runId). On resumes the queues and catches up: one full duplicate recompute, or an embedding backfill. Body: { enabled: boolean, deleteData?: boolean }. Allowed while the workspace is paused.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Malformed body' })
  @ApiResponse({ status: 404, description: 'Unknown feature' })
  @ApiResponse({
    status: 409,
    description: "The feature's data is being deleted right now",
  })
  setFeature(
    @Param('key') key: string,
    @Body() body: { enabled?: unknown; deleteData?: unknown },
  ): Promise<SetWorkspaceFeatureResult> {
    return this.features.set(key, body ?? {});
  }

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
