import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class AssetChunkDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  ordinal!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  charOffset!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  charLength!: number;

  @ApiProperty()
  @IsString()
  text!: string;
}

export class PutAssetChunksDto {
  @ApiProperty()
  @IsString()
  assetHash!: string;

  @ApiProperty({ type: [AssetChunkDto], maxItems: 5000 })
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => AssetChunkDto)
  chunks!: AssetChunkDto[];
}

export class SimilarFindingsQueryDto {
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class BoilerplateClustersQueryDto {
  @ApiPropertyOptional({ default: 0.95, minimum: 0.8, maximum: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(0.8)
  @Max(1)
  threshold = 0.95;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class EmbeddingReindexResponseDto {
  @ApiProperty()
  started!: boolean;

  @ApiProperty()
  spaceId!: string;
}

export class SimilarFindingAssetDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class SimilarFindingSourceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class SimilarFindingEvidenceAnalysisDto {
  @ApiProperty()
  importanceScore!: number;

  @ApiProperty()
  qualityScore!: number;

  @ApiProperty()
  similarCount!: number;

  @ApiPropertyOptional({ nullable: true })
  duplicateGroupHash?: string | null;

  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  reasons!: Array<Record<string, unknown>>;
}

export class SimilarFindingDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  findingType!: string;

  @ApiProperty()
  severity!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  matchedContent!: string;

  @ApiProperty({ minimum: -1, maximum: 1 })
  similarity!: number;

  @ApiProperty()
  confidence!: number;

  @ApiProperty()
  assetId!: string;

  @ApiProperty()
  sourceId!: string;

  @ApiPropertyOptional({ type: SimilarFindingAssetDto, nullable: true })
  asset?: SimilarFindingAssetDto | null;

  @ApiPropertyOptional({ type: SimilarFindingSourceDto, nullable: true })
  source?: SimilarFindingSourceDto | null;

  @ApiPropertyOptional({
    type: SimilarFindingEvidenceAnalysisDto,
    nullable: true,
  })
  evidenceAnalysis?: SimilarFindingEvidenceAnalysisDto | null;
}

export class BoilerplateClusterDto {
  @ApiProperty()
  groupHash!: string;

  @ApiProperty()
  findingCount!: number;

  @ApiProperty({ type: [String] })
  findingIds!: string[];

  @ApiProperty()
  meanImportance!: number;

  @ApiProperty()
  threshold!: number;
}
