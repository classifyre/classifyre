import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Severity } from '@prisma/client';
import { GraphResponseDto } from './graph.dto';

export class AssetSimilarityDto {
  @ApiProperty() fromId!: string;
  @ApiProperty() toId!: string;
  @ApiProperty({ description: 'Weighted match in [0,1]' }) weighted!: number;
  @ApiProperty({ description: '"related" | "likely_duplicate"' })
  relationType!: string;
}

export class CorrelationGraphResponseDto extends GraphResponseDto {
  @ApiProperty({ type: [AssetSimilarityDto] })
  similarities!: AssetSimilarityDto[];
}

export class CorrelationLabelWeightDto {
  @ApiProperty({ description: 'Normalized finding label (dynamic)' })
  label!: string;
  @ApiProperty({ description: 'Effective weight used in scoring' })
  weight!: number;
  @ApiProperty({
    description: 'Whether the label currently appears in the data',
  })
  inUse!: boolean;
}

export class ExclusionRuleDto {
  @ApiPropertyOptional({ description: 'Server-assigned id' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({
    enum: ['value', 'regex', 'label'],
    description:
      'value = exact normalized value; regex = pattern on value; label = ignore the whole label',
  })
  @IsIn(['value', 'regex', 'label'])
  mode!: 'value' | 'regex' | 'label';

  @ApiPropertyOptional({
    nullable: true,
    description: 'Label scope (or the excluded label when mode=label)',
  })
  @IsOptional()
  @IsString()
  label?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Exact value (mode=value) or regex source (mode=regex)',
  })
  @IsOptional()
  @IsString()
  value?: string | null;
}

export class CorrelationConfigResponseDto {
  @ApiProperty({ description: 'Fallback weight for any unlisted label' })
  defaultWeight!: number;
  @ApiProperty({
    description: 'Min weighted match to record a related link (0-1)',
  })
  relatedMin!: number;
  @ApiProperty({
    description: 'Min weighted match for a likely duplicate (0-1)',
  })
  duplicateMin!: number;
  @ApiProperty({ type: [CorrelationLabelWeightDto] })
  labels!: CorrelationLabelWeightDto[];
  @ApiProperty({ type: [ExclusionRuleDto] })
  exclusions!: ExclusionRuleDto[];
}

export class UpdateCorrelationConfigDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  defaultWeight?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  relatedMin?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  duplicateMin?: number;

  @ApiPropertyOptional({
    description: 'Per-label weight overrides ({ label: weight })',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  @IsOptional()
  @IsObject()
  labelWeights?: Record<string, number>;

  @ApiPropertyOptional({
    type: [ExclusionRuleDto],
    description: 'Full replacement list of exclusion rules',
  })
  @IsOptional()
  @IsArray()
  exclusions?: ExclusionRuleDto[];
}

/** Append a single exclusion rule (right-click quick-exclude). */
export class AddExclusionDto {
  @ApiProperty({ enum: ['value', 'regex', 'label'] })
  @IsIn(['value', 'regex', 'label'])
  mode!: 'value' | 'regex' | 'label';

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  label?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  value?: string | null;
}

export class CaseActionRequestDto {
  @ApiProperty({
    type: [String],
    description: 'Assets to add (graph selection)',
  })
  @IsArray()
  @IsString({ each: true })
  assetIds!: string[];

  @ApiPropertyOptional({
    description: 'Existing case to extend; omit to create one',
  })
  @IsOptional()
  @IsString()
  caseId?: string;

  @ApiPropertyOptional({ description: 'Title for a newly created case' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: Severity })
  @IsOptional()
  severity?: Severity;

  @ApiPropertyOptional({ description: "Also attach the assets' findings" })
  @IsOptional()
  @IsBoolean()
  attachFindings?: boolean;
}

export class CaseActionResponseDto {
  @ApiProperty() caseId!: string;
  @ApiProperty() caseTitle!: string;
  @ApiProperty() created!: boolean;
  @ApiProperty() assetsAdded!: number;
  @ApiProperty() findingsAttached!: number;
}

export class ValueOccurrenceAssetDto {
  @ApiProperty() assetId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() externalUrl!: string;
  @ApiProperty() assetType!: string;
  @ApiProperty() sourceType!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty() sourceName!: string;
  @ApiPropertyOptional({ nullable: true }) clusterId!: string | null;
}

export class ValueOccurrencesResponseDto {
  @ApiProperty() label!: string;
  @ApiProperty() value!: string;
  @ApiProperty() valueHash!: string;
  @ApiProperty({ type: [ValueOccurrenceAssetDto] })
  assets!: ValueOccurrenceAssetDto[];
}

export class RecomputeCorrelationResponseDto {
  @ApiProperty() assetsProcessed!: number;
  @ApiProperty() valuesIndexed!: number;
  @ApiProperty() relatedPairs!: number;
  @ApiProperty() duplicatePairs!: number;
  @ApiProperty() clustersTouched!: number;
}
