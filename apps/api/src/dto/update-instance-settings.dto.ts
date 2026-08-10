import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  INSTANCE_LANGUAGE_VALUES,
  INSTANCE_TIME_FORMAT_VALUES,
  MAX_CONCURRENT_RUNNERS_LIMIT,
  type InstanceLanguageValue,
  type InstanceTimeFormatValue,
} from './instance-settings-response.dto';

export class UpdateInstanceSettingsDto {
  @ApiPropertyOptional({
    description:
      'When false, AI assistant features are disabled instance-wide.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'When false, the autonomous AI harness and all of its agents are disabled instance-wide.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  harnessEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'When false, the MCP endpoint is disabled instance-wide.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  mcpEnabled?: boolean;

  @ApiPropertyOptional({ enum: INSTANCE_LANGUAGE_VALUES, example: 'ENGLISH' })
  @IsOptional()
  @IsIn(INSTANCE_LANGUAGE_VALUES)
  language?: InstanceLanguageValue;

  @ApiPropertyOptional({
    description: 'Default IANA timezone used for date/time rendering.',
    example: 'America/New_York',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  timezone?: string;

  @ApiPropertyOptional({
    enum: INSTANCE_TIME_FORMAT_VALUES,
    example: 'TWELVE_HOUR',
  })
  @IsOptional()
  @IsIn(INSTANCE_TIME_FORMAT_VALUES)
  timeFormat?: InstanceTimeFormatValue;

  @ApiPropertyOptional({
    description:
      'Id of the AI provider credential to use for the interactive AI assistant. ' +
      'Pass null or an empty string to clear the selection.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  aiProviderConfigId?: string | null;

  @ApiPropertyOptional({
    description:
      'Id of the AI provider credential to use for the autonomous AI harness. ' +
      'Pass null or an empty string to clear the selection.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  harnessAiProviderConfigId?: string | null;

  @ApiPropertyOptional({
    description:
      'When true, the autopilot inquiry agent manages inquiries automatically after scans.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autopilotInquiryEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Operator guidance for the inquiry agent: what is desired / worth investigating.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  autopilotInquiryDesired?: string | null;

  @ApiPropertyOptional({
    description:
      'Operator guidance for the inquiry agent: what is searchable in this instance.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  autopilotInquirySearchable?: string | null;

  @ApiPropertyOptional({
    description:
      'When true, the autopilot case agent manages investigation cases automatically after scans.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autopilotCaseEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Operator guidance for the case agent.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  autopilotCaseGuidance?: string | null;

  @ApiPropertyOptional({
    description:
      'When true, the config-tuning agent may change editable source config (detectors, sampling, optional, resources) — never the base connection.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autopilotConfigEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Operator guidance for the config-tuning agent.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  autopilotConfigGuidance?: string | null;

  @ApiPropertyOptional({
    description:
      'When true, the detector-authoring agent may create and train custom detectors.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autopilotDetectorEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Operator guidance for the detector-authoring agent.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  autopilotDetectorGuidance?: string | null;

  @ApiPropertyOptional({
    description:
      'When true, the escalation agent may raise operator notifications for high-severity cases.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autopilotEscalationEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Operator guidance for the escalation agent.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  autopilotEscalationGuidance?: string | null;

  @ApiPropertyOptional({
    description:
      'When true, the harness may call tools from connected external MCP servers.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autopilotMcpEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Master switch for adaptive ("automatic") source scheduling. Setting it ' +
      'false stops AUTO sources from being started without losing their state.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autoScheduleEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'How many scans this workspace may run at once. Scans are CPU-heavy, so ' +
      'this trades sweep speed against machine responsiveness: a workspace with ' +
      'many sources finishes a full pass roughly twice as fast at 2 as at 1. ' +
      '0 means unlimited.',
    example: 2,
    minimum: 0,
    maximum: MAX_CONCURRENT_RUNNERS_LIMIT,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CONCURRENT_RUNNERS_LIMIT)
  maxConcurrentRunners?: number;

  @ApiPropertyOptional({
    description:
      'Hugging Face token to set. Pass a token value to store (encrypted at rest). ' +
      'Pass null or an empty string to clear the stored token. ' +
      'Ignored when an instance-level HF_TOKEN is configured.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  hfToken?: string | null;
}
