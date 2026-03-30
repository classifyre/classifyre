import { ApiProperty } from '@nestjs/swagger';

export class MetricDefinitionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'False Positive Rate' })
  displayName: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ example: 'RATIO' })
  type: string;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;

  @ApiProperty()
  definition: Record<string, unknown>;

  @ApiProperty()
  allowedDimensions: string[];

  @ApiProperty({ nullable: true })
  glossaryTermId: string | null;

  @ApiProperty({ nullable: true })
  format: string | null;

  @ApiProperty({ nullable: true })
  unit: string | null;

  @ApiProperty({ nullable: true })
  color: string | null;

  @ApiProperty({ nullable: true })
  owner: string | null;

  @ApiProperty({ nullable: true })
  certifiedAt: Date | null;

  @ApiProperty({ nullable: true })
  certifiedBy: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({
    description: 'Current computed value (when requested)',
    required: false,
  })
  currentValue?: number | null;

  @ApiProperty({ required: false })
  glossaryTerm?: any;
}

export class SearchMetricDefinitionsResponseDto {
  @ApiProperty({ type: [MetricDefinitionResponseDto] })
  items: MetricDefinitionResponseDto[];

  @ApiProperty()
  total: number;
}
