import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ParsedTrainingExampleDto {
  @ApiProperty()
  label: string;

  @ApiProperty()
  text: string;

  @ApiProperty()
  accepted: boolean;

  @ApiProperty()
  source: string;

  @ApiPropertyOptional({
    description: '1-based line number in the uploaded file when available',
  })
  lineNumber?: number;
}

export class ParseTrainingExamplesResponseDto {
  @ApiProperty({
    description: 'Detected input format',
    example: 'csv',
  })
  format: string;

  @ApiProperty()
  totalRows: number;

  @ApiProperty()
  importedRows: number;

  @ApiProperty()
  skippedRows: number;

  @ApiProperty({ type: [String] })
  warnings: string[];

  @ApiProperty({ type: [ParsedTrainingExampleDto] })
  examples: ParsedTrainingExampleDto[];
}
