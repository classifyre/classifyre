import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export const WORKER_QUEUE_STATUS_VALUES = [
  'idle',
  'waiting_slot',
  'running',
  'failed',
  'stale',
] as const;
export type WorkerQueueStatusValue =
  (typeof WORKER_QUEUE_STATUS_VALUES)[number];

export class WorkerQueueInstanceDto {
  @ApiProperty({
    description: 'Worker process reporting this row (hostname:pid).',
    example: 'classifyre-worker-7c9f8b6d4-2xkzq:1',
  })
  instanceId: string;

  @ApiProperty({ enum: WORKER_QUEUE_STATUS_VALUES, example: 'running' })
  status: WorkerQueueStatusValue;

  @ApiProperty({ example: 1 })
  activeJobs: number;

  @ApiProperty({ type: [String], example: ['0f9c...'] })
  jobIds: string[];

  @ApiProperty({ nullable: true, type: String })
  startedAt: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'How long the current batch has been running, in ms.',
  })
  elapsedMs: number | null;

  @ApiProperty({ nullable: true, type: String })
  lastFinishedAt: string | null;

  @ApiProperty({ nullable: true, type: Number })
  lastDurationMs: number | null;

  @ApiProperty({ example: 42 })
  runCount: number;

  @ApiProperty({ example: 0 })
  failureCount: number;

  @ApiProperty({ nullable: true, type: String })
  lastError: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastErrorAt: string | null;

  @ApiProperty({
    description:
      'Last time this process reported. A row that stops beating is shown as stale rather than believed.',
  })
  heartbeatAt: string;
}

export class WorkerQueueDto {
  @ApiProperty({ example: 'embedding' })
  queue: string;

  @ApiProperty({
    enum: WORKER_QUEUE_STATUS_VALUES,
    example: 'idle',
    description:
      'Worst status reported by any worker serving this queue; stale when no worker is reporting at all.',
  })
  status: WorkerQueueStatusValue;

  @ApiProperty({ example: false })
  paused: boolean;

  @ApiProperty({ example: 0 })
  activeJobs: number;

  @ApiProperty({
    example: 26000,
    description: 'Jobs waiting to be picked up, reported by pg-boss.',
  })
  queuedCount: number;

  @ApiProperty({ example: 0 })
  deferredCount: number;

  @ApiProperty({ example: 26000 })
  totalCount: number;

  @ApiProperty({ example: 128 })
  runCount: number;

  @ApiProperty({ example: 2 })
  failureCount: number;

  @ApiProperty({ nullable: true, type: String })
  lastError: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastErrorAt: string | null;

  @ApiProperty({ type: [WorkerQueueInstanceDto] })
  instances: WorkerQueueInstanceDto[];
}

export class WorkerOverviewDto {
  @ApiProperty({
    example: 4,
    description:
      'Global concurrency slots shared by every namespace and queue. 0 means unlimited.',
  })
  concurrencyLimit: number;

  @ApiProperty({
    example: 900,
    description:
      'How long a batch may wait for a slot before it fails and pg-boss retries it. 0 means it waits forever.',
  })
  slotWaitTimeoutSeconds: number;

  @ApiProperty({ type: [WorkerQueueDto] })
  queues: WorkerQueueDto[];
}

export class SetWorkerQueuePausedDto {
  @ApiProperty({
    example: true,
    description:
      'Pause stops new batches from running; jobs already executing are not interrupted and cannot be cancelled.',
  })
  @IsBoolean()
  paused: boolean;
}
