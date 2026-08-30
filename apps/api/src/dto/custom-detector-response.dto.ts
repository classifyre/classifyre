import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomDetectorTrainingRunDto } from './custom-detector-training-run.dto';

export class CustomDetectorResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  pipelineSchema: Record<string, unknown>;

  @ApiProperty({
    nullable: true,
    description:
      'The engine this detector runs on (TAG, REGEX, LLM, GLINER2, ' +
      'TEXT_CLASSIFICATION, IMAGE_CLASSIFICATION, OBJECT_DETECTION). Lifted out ' +
      'of pipelineSchema so a list response can be audited as it stands: the ' +
      'type and severity of twenty detectors used to mean introspecting twenty ' +
      'opaque pipeline blobs.',
  })
  detectorType: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Default severity of the findings this detector produces, where its ' +
      'engine has one. Null for engines that derive severity per label.',
  })
  severity: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "Which dimension of this detector's findings carries the answer — " +
      '`findingType` for classifiers (the predicted label IS the answer), ' +
      '`matchedContent` for TAG and REGEX (the type names the rule, the value ' +
      'is the answer). The same distinction /inquiries/match-options reports, ' +
      'repeated here so a detector audit and a question author see one story.',
  })
  answerDimension: 'findingType' | 'matchedContent' | null;

  @ApiPropertyOptional({
    description:
      'AI provider credential ID backing this detector (LLM detectors only).',
    nullable: true,
  })
  aiProviderConfigId?: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  version: number;

  @ApiPropertyOptional()
  lastTrainedAt?: Date | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  lastTrainingSummary?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: CustomDetectorTrainingRunDto })
  latestTrainingRun?: CustomDetectorTrainingRunDto | null;

  @ApiProperty()
  findingsCount: number;

  @ApiProperty({
    description: 'Number of sources currently selecting this detector',
  })
  sourcesUsingCount: number;

  @ApiProperty({
    description:
      'Number of distinct sources where this detector produced findings',
  })
  sourcesWithFindingsCount: number;

  @ApiProperty({
    description: 'Recent source names using this detector',
    type: [String],
  })
  recentSourceNames: string[];

  @ApiProperty({
    description: 'Sources using this detector with their id and name',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
  })
  sourcesUsing: Array<{ id: string; name: string }>;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
