import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  INSTANCE_LANGUAGE_VALUES,
  INSTANCE_TIME_FORMAT_VALUES,
  type InstanceLanguageValue,
  type InstanceTimeFormatValue,
} from './instance-settings-response.dto';

export class UpdateInstanceSettingsDto {
  @ApiPropertyOptional({
    description:
      'When false, AI assistant features are disabled instance-wide.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'When false, the MCP endpoint is disabled instance-wide.',
    example: false,
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
      'Id of the AI provider credential to use as the instance-wide default. ' +
      'Pass null or an empty string to clear the selection.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  aiProviderConfigId?: string | null;

  @ApiPropertyOptional({
    description:
      'When true, the autopilot inquiry agent manages inquiries automatically after scans.',
    example: false,
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
    example: false,
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
}
