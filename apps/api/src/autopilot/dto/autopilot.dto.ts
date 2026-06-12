import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AgentDecisionAction,
  AgentDecisionOutcome,
  AgentKind,
  AgentLogChannel,
  AgentLogLevel,
  AgentMemoryKind,
  AgentRunStatus,
} from '@prisma/client';

export class QueryAgentRunsDto {
  @ApiPropertyOptional({ enum: AgentKind })
  @IsOptional()
  @IsEnum(AgentKind)
  agentKind?: AgentKind;

  @ApiPropertyOptional({ enum: AgentRunStatus })
  @IsOptional()
  @IsEnum(AgentRunStatus)
  status?: AgentRunStatus;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}

export class AgentDecisionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: AgentDecisionAction })
  action!: AgentDecisionAction;

  @ApiProperty({ enum: AgentDecisionOutcome })
  outcome!: AgentDecisionOutcome;

  @ApiPropertyOptional({ nullable: true, description: '"inquiry" | "case"' })
  entityType!: string | null;

  @ApiPropertyOptional({ nullable: true })
  entityId!: string | null;

  @ApiProperty({ description: 'Why the agent made (or skipped) this change' })
  rationale!: string;

  @ApiPropertyOptional({
    description: 'Exact mutation input / rejection detail',
    nullable: true,
  })
  payload!: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: Date;
}

export class AgentRunDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: AgentKind })
  agentKind!: AgentKind;

  @ApiProperty({ enum: AgentRunStatus })
  status!: AgentRunStatus;

  @ApiPropertyOptional({ nullable: true })
  sourceId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  runnerId!: string | null;

  @ApiProperty({ description: '"scan_completed" or "manual"' })
  trigger!: string;

  @ApiPropertyOptional({
    description: 'Operator instruction for manual cycles',
    nullable: true,
  })
  instruction!: string | null;

  @ApiProperty()
  attempts!: number;

  @ApiPropertyOptional({ nullable: true })
  error!: string | null;

  @ApiPropertyOptional({ nullable: true })
  summary!: string | null;

  @ApiProperty()
  decisionCount!: number;

  @ApiPropertyOptional({ nullable: true })
  startedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  finishedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class AgentRunDetailDto extends AgentRunDto {
  @ApiProperty({ type: [AgentDecisionDto] })
  decisions!: AgentDecisionDto[];
}

export class AgentRunListResponseDto {
  @ApiProperty({ type: [AgentRunDto] })
  items!: AgentRunDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  skip!: number;

  @ApiProperty()
  limit!: number;
}

// ── Execution logs ────────────────────────────────────────────────────────────

export class QueryAgentLogsDto {
  @ApiPropertyOptional({
    enum: AgentLogChannel,
    description:
      'BUSINESS = analyst narrative, TECHNICAL = mechanics/raw model I/O',
  })
  @IsOptional()
  @IsEnum(AgentLogChannel)
  channel?: AgentLogChannel;
}

export class AgentLogDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: AgentLogChannel })
  channel!: AgentLogChannel;

  @ApiProperty({ enum: AgentLogLevel })
  level!: AgentLogLevel;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional({
    description: 'Structured detail — raw model output, prompt sizes, errors',
    nullable: true,
  })
  payload!: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: Date;
}

export class AgentLogListResponseDto {
  @ApiProperty({ type: [AgentLogDto] })
  items!: AgentLogDto[];
}

// ── Manual trigger ────────────────────────────────────────────────────────────

export class TriggerAutopilotDto {
  @ApiPropertyOptional({
    description:
      'What the agents should pay attention to in this cycle (highest-priority prompt section).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instruction?: string;

  @ApiPropertyOptional({
    description: 'Limit the review to one source. Omit to review all sources.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceId?: string;
}

export class TriggerAutopilotResponseDto {
  @ApiProperty({
    description: 'Cycle identity — runs will carry this cycleKey',
  })
  cycleKey!: string;

  @ApiProperty()
  enqueued!: boolean;
}

// ── Memory management ─────────────────────────────────────────────────────────

export class QueryAgentMemoryDto {
  @ApiPropertyOptional({ enum: AgentMemoryKind })
  @IsOptional()
  @IsEnum(AgentMemoryKind)
  kind?: AgentMemoryKind;

  @ApiPropertyOptional({ description: 'Substring search over key and content' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}

export class AgentMemoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: AgentMemoryKind })
  kind!: AgentMemoryKind;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty({ type: [String] })
  tags!: string[];

  @ApiPropertyOptional({ nullable: true })
  refType!: string | null;

  @ApiPropertyOptional({ nullable: true })
  refId!: string | null;

  @ApiProperty({
    description: 'Reinforcement counter — higher = recalled first',
  })
  weight!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class AgentMemoryListResponseDto {
  @ApiProperty({ type: [AgentMemoryDto] })
  items!: AgentMemoryDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  skip!: number;

  @ApiProperty()
  limit!: number;
}

export class CreateAgentMemoryDto {
  @ApiProperty({ enum: AgentMemoryKind })
  @IsEnum(AgentMemoryKind)
  kind!: AgentMemoryKind;

  @ApiProperty({ description: 'Normalized lookup key (topic slug, term)' })
  @IsString()
  @MaxLength(200)
  key!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  content!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateAgentMemoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Set the reinforcement weight directly' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  weight?: number;
}
