import { ApiProperty } from '@nestjs/swagger';

export const INSTANCE_LANGUAGE_VALUES = [
  'AUTOMATIC',
  'ENGLISH',
  'GERMAN',
] as const;
export type InstanceLanguageValue = (typeof INSTANCE_LANGUAGE_VALUES)[number];

export const INSTANCE_TIME_FORMAT_VALUES = [
  'AUTOMATIC',
  'TWELVE_HOUR',
  'TWENTY_FOUR_HOUR',
] as const;
export type InstanceTimeFormatValue =
  (typeof INSTANCE_TIME_FORMAT_VALUES)[number];

export class InstanceSettingsResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({
    description:
      'When false, AI assistant features are disabled instance-wide.',
    example: true,
  })
  aiEnabled: boolean;

  @ApiProperty({
    description: 'When false, the MCP endpoint is disabled instance-wide.',
    example: true,
  })
  mcpEnabled: boolean;

  @ApiProperty({ enum: INSTANCE_LANGUAGE_VALUES, example: 'ENGLISH' })
  language: InstanceLanguageValue;

  @ApiProperty({
    description:
      'Default IANA timezone used for date/time rendering. Use "AUTOMATIC" to detect from browser.',
    example: 'AUTOMATIC',
  })
  timezone: string;

  @ApiProperty({
    enum: INSTANCE_TIME_FORMAT_VALUES,
    example: 'TWELVE_HOUR',
  })
  timeFormat: InstanceTimeFormatValue;

  @ApiProperty({
    description:
      'Read-only. When true, the instance runs in demo mode and all mutating operations are rejected.',
    example: false,
  })
  demoMode: boolean;

  @ApiProperty({
    description:
      'Read-only. True when S3-compatible object storage is configured. When false, runner logs are streamed live but not persisted after the run completes.',
    example: false,
  })
  s3Configured: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
