import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TrainingExampleItemDto {
  @ApiProperty({ description: 'Entity label or classification label' })
  @IsString()
  label: string;

  @ApiProperty({
    description: 'Context text containing the entity or to classify',
  })
  @IsString()
  text: string;

  @ApiPropertyOptional({
    description:
      'Specific entity value (span text) — required for NER fine-tuning. Omit for classification.',
  })
  @IsOptional()
  @IsString()
  value?: string;

  @ApiProperty({
    description: 'true = positive example, false = negative / false-positive',
  })
  @IsBoolean()
  accepted: boolean;

  @ApiPropertyOptional({ description: 'Source filename the example came from' })
  @IsOptional()
  @IsString()
  source?: string;
}

export class SaveTrainingExamplesDto {
  @ApiProperty({ type: [TrainingExampleItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrainingExampleItemDto)
  examples: TrainingExampleItemDto[];

  @ApiPropertyOptional({
    description: 'When true, delete all existing examples before saving',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  clearExisting?: boolean;
}

export class TrainingExampleDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  customDetectorId: string;

  @ApiProperty()
  label: string;

  @ApiProperty()
  text: string;

  @ApiPropertyOptional()
  value?: string | null;

  @ApiProperty()
  accepted: boolean;

  @ApiPropertyOptional()
  source?: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class TrainingExamplesStatsDto {
  @ApiProperty()
  total: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        positive: { type: 'number' },
        negative: { type: 'number' },
      },
    },
  })
  byLabel: Record<string, { positive: number; negative: number }>;
}
