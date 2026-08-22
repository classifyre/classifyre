import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WorkerQueuesService } from '../scheduler/worker-queues.service';
import {
  SetWorkerQueuePausedDto,
  WorkerOverviewDto,
  WorkerQueueDto,
} from '../dto/worker-queue.dto';

/**
 * Background-worker visibility for the current workspace.
 *
 * Reads come from a `public`-schema table written by the worker processes, so
 * these endpoints answer correctly on `SERVICE_ROLE=api` pods, which never run
 * a queue handler themselves.
 *
 * Pause/resume is deliberately non-GET, which means `DemoModeGuard` blocks it
 * on a demo instance without any extra annotation.
 */
@ApiTags('Worker Queues')
@Controller('worker-queues')
export class WorkerQueuesController {
  constructor(private readonly workerQueues: WorkerQueuesService) {}

  @Get()
  @ApiOperation({
    summary: 'List background queues with live worker state and backlog',
    description:
      'Aggregates every worker process reporting on each queue. A row whose heartbeat has gone quiet is reported as stale rather than believed, so an OOM-killed pod cannot leave a queue looking busy forever.',
  })
  @ApiResponse({ status: 200, type: WorkerOverviewDto })
  overview(): Promise<WorkerOverviewDto> {
    return this.workerQueues.overview();
  }

  @Put(':queue/paused')
  @ApiOperation({
    summary: 'Pause or resume a background queue',
    description:
      'Pausing is database-backed, so it applies to every worker replica rather than only the pod that served this request. A batch handed to a paused queue is refused and retried by pg-boss, so nothing is lost. Jobs already running cannot be cancelled — pause and let them drain, or restart the worker.',
  })
  @ApiBody({ type: SetWorkerQueuePausedDto })
  @ApiResponse({ status: 200, type: WorkerQueueDto })
  setPaused(
    @Param('queue') queue: string,
    @Body() body: SetWorkerQueuePausedDto,
  ): Promise<WorkerQueueDto> {
    // There is no global ValidationPipe, so the DTO decorators do not run at
    // request time; coerce here rather than trusting the declared type.
    return this.workerQueues.setPaused(queue, body?.paused === true);
  }
}
