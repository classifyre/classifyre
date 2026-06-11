import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import {
  AgentDecisionAction,
  AgentDecisionOutcome,
  AgentKind,
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

  @ApiProperty()
  trigger!: string;

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
