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
}
