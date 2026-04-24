import { ApiProperty } from '@nestjs/swagger';
import { TriggerType, RunnerExecutionMode, RunnerStatus } from '@prisma/client';
import {
  IsOptional,
  IsEnum,
  IsString,
  IsInt,
  Min,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export const LOG_LEVELS = [
  'TRACE',
  'DEBUG',
  'INFO',
  'WARN',
  'ERROR',
  'FATAL',
  'UNKNOWN',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SORT_ORDERS = ['asc', 'desc'] as const;
export type LogSortOrder = (typeof LOG_SORT_ORDERS)[number];

export const LOG_STREAMS = ['stderr', 'stdout', 'combined'] as const;
export type LogStream = (typeof LOG_STREAMS)[number];

export class StartRunnerDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  triggeredBy?: string;

  @ApiProperty({ enum: TriggerType, default: TriggerType.MANUAL })
  @IsOptional()
  @IsEnum(TriggerType)
  triggerType?: TriggerType = TriggerType.MANUAL;
}

export class CreateExternalRunnerDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  triggeredBy?: string;
}

export class ListRunnersQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiProperty({ enum: RunnerStatus, required: false })
  @IsOptional()
  @IsEnum(RunnerStatus)
  status?: RunnerStatus;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number = 20;
}

export class SourceInfoDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  type: string;
}

export class RunnerDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  sourceId: string;

  @ApiProperty({ required: false, nullable: true })
  triggeredBy?: string | null;

  @ApiProperty()
  triggeredAt: Date;

  @ApiProperty({ enum: TriggerType })
  triggerType: TriggerType;

  @ApiProperty({ enum: RunnerStatus })
  status: RunnerStatus;

  @ApiProperty({
    enum: RunnerExecutionMode,
    required: false,
    nullable: true,
  })
  executionMode?: RunnerExecutionMode | null;

  @ApiProperty({ required: false, nullable: true })
  startedAt?: Date | null;

  @ApiProperty({ required: false, nullable: true })
  completedAt?: Date | null;

  @ApiProperty({ required: false, nullable: true })
  durationMs?: number | null;

  @ApiProperty({ type: Object })
  recipe: Record<string, unknown>;

  @ApiProperty({ type: Object, required: false, nullable: true })
  detectors?: Record<string, unknown> | null;

  @ApiProperty({ default: 0 })
  assetsCreated: number;

  @ApiProperty({ default: 0 })
  assetsUpdated: number;

  @ApiProperty({ default: 0 })
  assetsUnchanged: number;

  @ApiProperty({ default: 0 })
  assetsDeleted: number;

  @ApiProperty({ default: 0 })
  totalFindings: number;

  @ApiProperty({ required: false, nullable: true })
  errorMessage?: string | null;

  @ApiProperty({ type: Object, required: false, nullable: true })
  errorDetails?: Record<string, unknown> | null;

  @ApiProperty({ required: false, nullable: true })
  jobName?: string | null;

  @ApiProperty({ required: false, nullable: true })
  jobNamespace?: string | null;

  @ApiProperty({ type: SourceInfoDto, required: false })
  source?: SourceInfoDto;
}

export class ListRunnersResponseDto {
  @ApiProperty({ type: [RunnerDto] })
  runners: RunnerDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  skip: number;

  @ApiProperty()
  take: number;
}

export class StopRunnerResponseDto {
  @ApiProperty()
  message: string;
}

export class DeleteRunnerResponseDto {
  @ApiProperty()
  message: string;
}

export class SearchRunnerLogsBodyDto {
  @ApiProperty({ required: false, description: 'Opaque pagination cursor' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiProperty({ required: false, default: 200, minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number = 200;

  @ApiProperty({ required: false, description: 'Full-text search on message' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    required: false,
    type: [String],
    enum: LOG_LEVELS,
    description: 'Filter by log levels',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  levels?: string[];

  @ApiProperty({
    required: false,
    enum: LOG_SORT_ORDERS,
    default: 'asc',
    description:
      'asc = oldest first (cursor-based), desc = newest first (index-based)',
  })
  @IsOptional()
  @IsString()
  sortOrder?: LogSortOrder = 'asc';

  @ApiProperty({
    required: false,
    type: [String],
    enum: LOG_STREAMS,
    description: 'Filter by stream type',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  streams?: string[];
}

export class RunnerLogEntryDto {
  @ApiProperty({ description: 'Opaque pagination cursor for this entry' })
  cursor: string;

  @ApiProperty({
    description: 'Log timestamp in ISO-8601 format',
    required: false,
    nullable: true,
  })
  timestamp: string | null;

  @ApiProperty({
    description: 'Log stream source',
    enum: LOG_STREAMS,
  })
  stream: 'stderr' | 'stdout' | 'combined';

  @ApiProperty()
  message: string;

  @ApiProperty({
    description: 'Inferred log level',
    enum: LOG_LEVELS,
  })
  level: LogLevel;
}

export class RunnerLogsResponseDto {
  @ApiProperty()
  runnerId: string;

  @ApiProperty({ type: [RunnerLogEntryDto] })
  entries: RunnerLogEntryDto[];

  @ApiProperty({ required: false, nullable: true })
  nextCursor: string | null;

  @ApiProperty({ description: 'Cursor to continue reading from (byte offset)' })
  cursor: string;

  @ApiProperty()
  hasMore: boolean;

  @ApiProperty({ minimum: 1, maximum: 1000 })
  take: number;
}
