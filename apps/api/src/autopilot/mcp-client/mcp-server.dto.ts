import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AgentKind } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const TRANSPORTS = ['stdio', 'http'] as const;

export class CreateMcpServerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ description: 'Stable slug; generated from name if omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  slug?: string;

  @ApiProperty({ enum: TRANSPORTS })
  @IsIn(TRANSPORTS)
  transport!: (typeof TRANSPORTS)[number];

  @ApiPropertyOptional({ description: 'stdio: executable' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  command?: string;

  @ApiPropertyOptional({ type: [String], description: 'stdio: arguments' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  args?: string[];

  @ApiPropertyOptional({ description: 'http: server URL' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  url?: string;

  @ApiPropertyOptional({
    description: 'http: auth headers (stored encrypted, never returned)',
  })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Trusted servers may run mutating tools; untrusted are observe-only',
  })
  @IsOptional()
  @IsBoolean()
  trusted?: boolean;

  @ApiPropertyOptional({
    enum: AgentKind,
    isArray: true,
    description: 'Missions allowed to use these tools. Empty = all missions.',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(AgentKind, { each: true })
  agentKinds?: AgentKind[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Discovered tool names to expose. Empty = all.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  toolAllowlist?: string[];
}

export class UpdateMcpServerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: TRANSPORTS })
  @IsOptional()
  @IsIn(TRANSPORTS)
  transport?: (typeof TRANSPORTS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  command?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  args?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  url?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Replace auth headers; pass null/empty to clear',
  })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string> | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  trusted?: boolean;

  @ApiPropertyOptional({ enum: AgentKind, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(AgentKind, { each: true })
  agentKinds?: AgentKind[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  toolAllowlist?: string[];
}

export class McpServerResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() transport!: string;
  @ApiPropertyOptional({ nullable: true }) command!: string | null;
  @ApiProperty({ type: [String] }) args!: string[];
  @ApiPropertyOptional({ nullable: true }) url!: string | null;
  @ApiProperty({ description: 'Whether auth headers are stored (values hidden)' })
  hasHeaders!: boolean;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() trusted!: boolean;
  @ApiProperty({ type: [String] }) agentKinds!: string[];
  @ApiProperty({ type: [String] }) toolAllowlist!: string[];
  @ApiProperty({ type: [String] }) discoveredTools!: string[];
  @ApiPropertyOptional({ nullable: true }) lastError!: string | null;
  @ApiPropertyOptional({ nullable: true }) lastConnectedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class McpServerTestResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ type: [String] }) tools!: string[];
  @ApiPropertyOptional({ nullable: true }) error!: string | null;
}
