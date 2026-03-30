import { ApiProperty } from '@nestjs/swagger';

export const INSTANCE_LANGUAGE_VALUES = ['ENGLISH', 'GERMAN'] as const;
export type InstanceLanguageValue = (typeof INSTANCE_LANGUAGE_VALUES)[number];

export const INSTANCE_TIME_FORMAT_VALUES = [
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
    description: 'Default IANA timezone used for date/time rendering.',
    example: 'UTC',
  })
  timezone: string;

  @ApiProperty({
    enum: INSTANCE_TIME_FORMAT_VALUES,
    example: 'TWELVE_HOUR',
  })
  timeFormat: InstanceTimeFormatValue;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
