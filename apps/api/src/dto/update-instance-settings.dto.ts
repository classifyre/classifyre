import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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
  type InstanceLanguageValue,
  type InstanceTimeFormatValue,
} from './instance-settings-response.dto';

export class UpdateInstanceSettingsDto {
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
      'Id of the AI provider credential to use for and enable the interactive AI assistant. ' +
      'Pass null or an empty string to clear the selection and disable it.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  aiProviderConfigId?: string | null;

  @ApiPropertyOptional({
    description:
      'Id of the AI provider credential to use for and enable the autonomous AI harness. ' +
      'Pass null or an empty string to clear the selection and disable it.',
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
      'When true, the autopilot case agent manages investigation cases automatically after scans.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autopilotCaseEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'When true, the config-tuning agent may change editable source config (detectors, sampling, optional, resources) — never the base connection.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autopilotConfigEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'When true, the detector-authoring agent may create and train custom detectors.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autopilotDetectorEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'When true, the escalation agent may raise operator notifications for high-severity cases.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autopilotEscalationEnabled?: boolean;

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
      'Hugging Face token to set. Pass a token value to store (encrypted at rest). ' +
      'Pass null or an empty string to clear the stored token. ' +
      'Ignored when an instance-level HF_TOKEN is configured.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  hfToken?: string | null;

  @ApiPropertyOptional({
    description:
      'How long one agent run may take before it is stopped. A run holds a namespace job slot, so a wedged one stalls every queue behind it.',
    example: 20,
    minimum: 1,
    maximum: 480,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(480)
  harnessRunBudgetMinutes?: number;

  @ApiPropertyOptional({
    description:
      'When a run still marked RUNNING is presumed dead and reaped. Keep it above the run budget: past this a run is not slow, it is gone.',
    example: 60,
    minimum: 1,
    maximum: 1440,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  harnessRunStaleAfterMinutes?: number;

  @ApiPropertyOptional({
    description:
      'Wall-clock budget for one cycle. Checked before each agent starts, so a chain can overshoot by at most one run budget.',
    example: 30,
    minimum: 1,
    maximum: 720,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  harnessCycleBudgetMinutes?: number;

  @ApiPropertyOptional({
    description:
      'Scored findings above which the evidence gate opens regardless of coverage.',
    example: 2000,
    minimum: 0,
    maximum: 10000000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  harnessEvidenceUsableFindings?: number;

  @ApiPropertyOptional({
    description: 'Character cap on one tool result before it is truncated.',
    example: 8000,
    minimum: 1000,
    maximum: 100000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(100000)
  harnessObservationChars?: number;

  @ApiPropertyOptional({
    description:
      'Character cap on all tool results in one turn. The transcript is resent every iteration, so this bounds its quadratic growth.',
    example: 24000,
    minimum: 1000,
    maximum: 500000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(500000)
  harnessTurnObservationChars?: number;

  @ApiPropertyOptional({
    description: 'How many ranked findings a run may see at once.',
    example: 25,
    minimum: 1,
    maximum: 200,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  harnessMaxRankedFindings?: number;

  @ApiPropertyOptional({
    description: 'How many glossary entries are injected into each run.',
    example: 20,
    minimum: 0,
    maximum: 200,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  harnessMaxGlossaryEntries?: number;

  @ApiPropertyOptional({
    description: 'How many recalled memories are injected into each run.',
    example: 30,
    minimum: 0,
    maximum: 200,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  harnessMaxRecalledMemories?: number;

  @ApiPropertyOptional({
    description: 'How often the memory-consolidation agent runs, in days.',
    example: 2,
    minimum: 1,
    maximum: 90,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  harnessDreamIntervalDays?: number;

  @ApiPropertyOptional({
    description:
      'Fraction of open findings that must be scored for the evidence gate to open, when the absolute floor is not met.',
    example: 0.25,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  harnessEvidenceUsableCoverage?: number;

  @ApiPropertyOptional({
    description:
      'Below this coverage the agents are told their triage order is partial. Shapes the prompt; does not block a run.',
    example: 0.8,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  harnessEvidenceWarnCoverage?: number;

  @ApiPropertyOptional({
    description:
      'Importance at or above which a single new finding earns an immediate cycle instead of waiting for the batch.',
    example: 0.75,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  harnessExpressImportance?: number;
}
