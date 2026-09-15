import { ApiProperty } from '@nestjs/swagger';

export class CohortRunYieldDto {
  @ApiProperty() runnerId!: string;
  @ApiProperty() triggeredAt!: Date;

  @ApiProperty({
    type: Object,
    description: 'Per band: {visited, hits, exhausted}.',
  })
  bands!: Record<string, { visited: number; hits: number; exhausted: boolean }>;

  @ApiProperty({ type: Object, description: 'Percent per band.' })
  weightsUsed!: Record<string, number>;
}

export class CohortWeightsPreviewDto {
  @ApiProperty({ description: 'The name the notebook passed to ctx.cohort().' })
  name!: string;

  @ApiProperty({ enum: ['auto', 'fixed'] })
  mode!: 'auto' | 'fixed';

  @ApiProperty({
    type: Object,
    description: 'Percent per band for the next run.',
  })
  weights!: Record<string, number>;

  @ApiProperty({ enum: ['no_history', 'cold_start', 'measured', 'fixed'] })
  reason!: 'no_history' | 'cold_start' | 'measured' | 'fixed';

  @ApiProperty({
    type: Object,
    description:
      'Per band: visits and hits over the last runs, their decayed values and the rate used.',
  })
  derivation!: Record<string, unknown>;

  @ApiProperty({ type: [CohortRunYieldDto] })
  runs!: CohortRunYieldDto[];
}
