import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomDetectorMethod } from '@prisma/client';
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

  @ApiProperty({ enum: CustomDetectorMethod })
  method: CustomDetectorMethod;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  version: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  config: Record<string, unknown>;

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
