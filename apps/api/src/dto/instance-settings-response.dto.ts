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
      'Id of the AI provider credential used as the instance-wide default. Null when unset.',
    nullable: true,
  })
  aiProviderConfigId: string | null;

  @ApiProperty({
    description:
      'When true, the autopilot inquiry agent manages inquiries automatically after scans.',
    example: false,
  })
  autopilotInquiryEnabled: boolean;

  @ApiProperty({
    description:
      'Operator guidance for the inquiry agent: what is desired / worth investigating.',
    nullable: true,
  })
  autopilotInquiryDesired: string | null;

  @ApiProperty({
    description:
      'Operator guidance for the inquiry agent: what is searchable in this instance.',
    nullable: true,
  })
  autopilotInquirySearchable: string | null;

  @ApiProperty({
    description:
      'When true, the autopilot case agent manages investigation cases automatically after scans.',
    example: false,
  })
  autopilotCaseEnabled: boolean;

  @ApiProperty({
    description: 'Operator guidance for the case agent.',
    nullable: true,
  })
  autopilotCaseGuidance: string | null;

  @ApiProperty({
    description:
      'When true, the config-tuning agent may change editable source config.',
    example: false,
  })
  autopilotConfigEnabled: boolean;

  @ApiProperty({
    description: 'Operator guidance for the config-tuning agent.',
    nullable: true,
  })
  autopilotConfigGuidance: string | null;

  @ApiProperty({
    description:
      'When true, the detector-authoring agent may create/train detectors.',
    example: false,
  })
  autopilotDetectorEnabled: boolean;

  @ApiProperty({
    description: 'Operator guidance for the detector-authoring agent.',
    nullable: true,
  })
  autopilotDetectorGuidance: string | null;

  @ApiProperty({
    description:
      'When true, the harness may call tools from connected external MCP servers.',
    example: false,
  })
  autopilotMcpEnabled: boolean;

  @ApiProperty({
    description:
      'Read-only. When true, the instance runs in demo mode and all mutating operations are rejected.',
    example: false,
  })
  demoMode: boolean;

  @ApiProperty({
    description:
      'Read-only. Whether a user-configured Hugging Face token is stored (encrypted at rest).',
    example: false,
  })
  hfTokenSet: boolean;

  @ApiProperty({
    description:
      'Read-only. Whether an instance-level HF_TOKEN is configured via Kubernetes Secret. ' +
      'When true, the instance token takes priority over any user-configured token.',
    example: false,
  })
  hfTokenInstanceSet: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
