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

export class ParseTrainingExamplesSkippedReasonsDto {
  @ApiProperty({ description: 'Rows skipped because label cell was empty' })
  missingLabel: number;

  @ApiProperty({ description: 'Rows skipped because text cell was empty' })
  missingText: number;

  @ApiProperty({ description: 'Rows removed as exact duplicates' })
  duplicates: number;
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

  @ApiPropertyOptional({
    type: [String],
    description: 'All column headers found in the file (xlsx/csv only)',
  })
  availableColumns?: string[];

  @ApiPropertyOptional({
    description: 'Column header auto-detected as the label column',
  })
  detectedLabelColumn?: string;

  @ApiPropertyOptional({
    description: 'Column header auto-detected as the text column',
  })
  detectedTextColumn?: string;

  @ApiPropertyOptional({
    type: ParseTrainingExamplesSkippedReasonsDto,
    description: 'Breakdown of why rows were skipped',
  })
  skippedReasons?: ParseTrainingExamplesSkippedReasonsDto;
}
