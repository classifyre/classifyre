import { ApiProperty } from '@nestjs/swagger';

export class GlossaryTermResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'Security Threats' })
  displayName: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ nullable: true, example: 'Security' })
  category: string | null;

  @ApiProperty()
  filterMapping: Record<string, unknown>;

  @ApiProperty({ nullable: true, example: '#ff2b2b' })
  color: string | null;

  @ApiProperty({ nullable: true, example: 'shield-alert' })
  icon: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({
    description: 'Number of findings matching this glossary term',
    required: false,
  })
  findingCount?: number;

  @ApiProperty({
    description: 'Metrics associated with this glossary term',
    required: false,
  })
  metrics?: any[];
}

export class SearchGlossaryTermsResponseDto {
  @ApiProperty({ type: [GlossaryTermResponseDto] })
  items: GlossaryTermResponseDto[];

  @ApiProperty({ example: 6 })
  total: number;
}
