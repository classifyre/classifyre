import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CustomDetectorExampleDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  pipelineSchema: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Suggested detector key, for templates that ship one (code detectors do).',
  })
  key?: string;

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Test scenarios the template ships with: { name, inputText | inputAsset, expectedOutcome }.',
  })
  testScenarios?: Array<Record<string, unknown>>;
}
