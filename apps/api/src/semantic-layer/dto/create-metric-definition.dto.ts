import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateMetricDefinitionDto {
  @ApiProperty({
    description: 'Human-readable display name',
    example: 'False Positive Rate',
  })
  @IsNotEmpty()
  @IsString()
  displayName: string;

  @ApiProperty({
    description: 'Explanation of what this metric measures',
    example:
      'Percentage of findings marked as false positive out of total findings',
    required: false,
  })
  description?: string;

  @ApiProperty({
    description: 'Metric calculation type',
    enum: ['SIMPLE', 'RATIO', 'DERIVED', 'TREND'],
    example: 'RATIO',
  })
  type: 'SIMPLE' | 'RATIO' | 'DERIVED' | 'TREND';

  @ApiProperty({
    description: 'Metric calculation definition (depends on type)',
    example: {
      numerator: {
        aggregation: 'COUNT',
        entity: 'finding',
        filters: { statuses: ['FALSE_POSITIVE'] },
      },
      denominator: {
        aggregation: 'COUNT',
        entity: 'finding',
      },
    },
  })
  definition: Record<string, any>;

  @ApiProperty({
    description: 'Dimensions this metric can be sliced by',
    example: ['severity', 'detectorType', 'source'],
    required: false,
  })
  allowedDimensions?: string[];

  @ApiProperty({
    description: 'Associated glossary term id',
    required: false,
  })
  glossaryTermId?: string;

  @ApiProperty({
    description: 'Display format',
    example: 'percentage',
    required: false,
  })
  format?: string;

  @ApiProperty({
    description: 'Display unit',
    example: '%',
    required: false,
  })
  unit?: string;

  @ApiProperty({ required: false })
  color?: string;

  @ApiProperty({ required: false })
  owner?: string;
}
