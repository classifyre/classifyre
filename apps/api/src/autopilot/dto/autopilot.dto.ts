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

  @ApiPropertyOptional({ description: 'Only runs focused on this case' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  caseId?: string;

  @ApiPropertyOptional({ description: 'Only runs for this source' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceId?: string;

  @ApiPropertyOptional({ enum: AgentRunStatus })
  @IsOptional()
  @IsEnum(AgentRunStatus)
  status?: AgentRunStatus;

  @ApiPropertyOptional({
    description: 'Trigger origin: scan_completed | manual | schedule',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  trigger?: string;

  @ApiPropertyOptional({
    description: 'Substring search over summary, instruction and error',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    description: 'Only runs created at/after this ISO time',
  })
  @IsOptional()
  @IsString()
  since?: string;

  @ApiPropertyOptional({
    description: 'Only runs created at/before this ISO time',
  })
  @IsOptional()
  @IsString()
  until?: string;

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

// ── Activity feed (cross-run decision timeline, server-side filterable) ─────────

export class QueryAgentActivityDto {
  @ApiPropertyOptional({ enum: AgentKind })
  @IsOptional()
  @IsEnum(AgentKind)
  agentKind?: AgentKind;

  @ApiPropertyOptional({ enum: AgentDecisionAction })
  @IsOptional()
  @IsEnum(AgentDecisionAction)
  action?: AgentDecisionAction;

  @ApiPropertyOptional({ enum: AgentDecisionOutcome })
  @IsOptional()
  @IsEnum(AgentDecisionOutcome)
  outcome?: AgentDecisionOutcome;

  @ApiPropertyOptional({
    description: 'inquiry | case | source | detector | memory | system | asset',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  entityType?: string;

  @ApiPropertyOptional({ description: 'Substring search over the rationale' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'ISO time lower bound' })
  @IsOptional()
  @IsString()
  since?: string;

  @ApiPropertyOptional({ description: 'ISO time upper bound' })
  @IsOptional()
  @IsString()
  until?: string;

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

export class AgentActivityItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  runId!: string;

  @ApiProperty({ enum: AgentKind })
  agentKind!: AgentKind;

  @ApiProperty({ enum: AgentRunStatus })
  runStatus!: AgentRunStatus;

  @ApiProperty({ enum: AgentDecisionAction })
  action!: AgentDecisionAction;

  @ApiProperty({ enum: AgentDecisionOutcome })
  outcome!: AgentDecisionOutcome;

  @ApiPropertyOptional({ nullable: true })
  entityType!: string | null;

  @ApiPropertyOptional({ nullable: true })
  entityId!: string | null;

  @ApiProperty()
  rationale!: string;

  @ApiPropertyOptional({ nullable: true })
  payload!: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: Date;
}

export class AgentActivityListResponseDto {
  @ApiProperty({ type: [AgentActivityItemDto] })
  items!: AgentActivityItemDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  skip!: number;

  @ApiProperty()
  limit!: number;
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

  @ApiPropertyOptional({
    description: 'Case this run is focused on (case-targeted manual runs)',
    nullable: true,
  })
  caseId!: string | null;

  @ApiProperty({ description: '"scan_completed", "manual" or "schedule"' })
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

  @ApiPropertyOptional({ enum: AgentLogLevel })
  @IsOptional()
  @IsEnum(AgentLogLevel)
  level?: AgentLogLevel;

  @ApiPropertyOptional({ description: 'Substring search over the message' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
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

  @ApiPropertyOptional({
    enum: [
      AgentKind.INQUIRY,
      AgentKind.CASE,
      AgentKind.CONFIG,
      AgentKind.DETECTOR_AUTHOR,
    ],
    description:
      'Run only one mission. Omit to run the full investigation cycle (inquiry then case). Implied CASE when caseId is set. Use POST /autopilot/dream for memory consolidation.',
  })
  @IsOptional()
  @IsEnum(AgentKind)
  agentKind?: AgentKind;

  @ApiPropertyOptional({
    description:
      'Focus the case agent on ONE case: it receives the full case detail (hypotheses, evidence, findings, edges) and can connect/disconnect edges, build evidence paths and create/update hypotheses with supporting evidence — steered by the instruction.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  caseId?: string;
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

// ── System brief ───────────────────────────────────────────────────────────────

export class AgentSystemBriefDto {
  @ApiProperty({ description: 'Model-authored narrative of the whole system' })
  content!: string;

  @ApiProperty({
    description:
      'Structured snapshot (source/detector counts, finding landscape, …)',
  })
  facts!: Record<string, unknown>;

  @ApiProperty()
  version!: number;

  @ApiPropertyOptional({ nullable: true })
  updatedBy!: string | null;

  @ApiPropertyOptional({ nullable: true })
  updatedAt!: Date | null;
}

// ── Tool registry & missions (capability map) ──────────────────────────────────

export class HarnessToolDto {
  @ApiProperty({
    description: 'Namespaced tool name, e.g. "config.tune_source"',
  })
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ description: 'read | mutate' })
  sideEffect!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Domain gated for OBSERVE_ONLY (inquiry/case/source/…)',
  })
  domain!: string | null;
}

export class HarnessMissionDto {
  @ApiProperty({ enum: AgentKind })
  kind!: AgentKind;

  @ApiProperty({
    description: 'The goal/system-prompt that frames the mission',
  })
  goal!: string;

  @ApiProperty({
    type: [String],
    description: 'Tool names this mission may call',
  })
  allowedTools!: string[];

  @ApiProperty()
  maxIterations!: number;
}

export class HarnessToolsResponseDto {
  @ApiProperty({ type: [HarnessToolDto] })
  tools!: HarnessToolDto[];

  @ApiProperty({ type: [HarnessMissionDto] })
  missions!: HarnessMissionDto[];
}

export class UpdateSystemBriefDto {
  @ApiProperty({
    description: 'Full replacement narrative for the system brief',
  })
  @IsString()
  @MaxLength(20000)
  content!: string;
}

// ── Observability stats (mission-control header) ───────────────────────────────

export class AutopilotStatsDto {
  @ApiProperty({ description: 'Total agent runs ever recorded' })
  totalRuns!: number;

  @ApiProperty({ description: 'Runs created in the last 24h' })
  runsLast24h!: number;

  @ApiProperty({ description: 'Runs currently RUNNING or PENDING' })
  activeRuns!: number;

  @ApiProperty({ description: 'Decisions APPLIED (mutations made)' })
  decisionsApplied!: number;

  @ApiProperty({ description: 'Decisions SKIPPED due to observe-only' })
  decisionsSkipped!: number;

  @ApiProperty({ description: 'Decisions FAILED' })
  decisionsFailed!: number;

  @ApiProperty({
    description: 'Long-lived memory entries the agent has learned',
  })
  memoryCount!: number;

  @ApiProperty({ description: 'Current system brief version (0 = none yet)' })
  briefVersion!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'When the autopilot last did anything',
  })
  lastActivityAt!: Date | null;

  @ApiProperty({
    description: 'Run counts grouped by agent kind',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  runsByKind!: Record<string, number>;
}
