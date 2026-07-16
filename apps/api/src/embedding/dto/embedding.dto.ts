import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class EmbeddingSpaceDto {
  @ApiProperty({ default: 'sentence-transformers/all-MiniLM-L6-v2' })
  @IsString()
  model!: string;

  @ApiProperty({ default: 'main' })
  @IsString()
  revision!: string;

  @ApiProperty({ default: 384 })
  @IsInt()
  @Min(1)
  @Max(4096)
  dim!: number;

  @ApiProperty({ default: 'mean' })
  @IsString()
  pooling!: string;

  @ApiProperty({ default: true })
  @IsBoolean()
  normalized!: boolean;
}

export class MissingEmbeddingsDto {
  @ApiProperty({ type: EmbeddingSpaceDto })
  @ValidateNested()
  @Type(() => EmbeddingSpaceDto)
  space!: EmbeddingSpaceDto;

  @ApiProperty({ type: [String], maxItems: 10000 })
  @IsArray()
  @ArrayMaxSize(10000)
  @Length(64, 64, { each: true })
  contentHashes!: string[];
}

export class EmbeddingVectorDto {
  @ApiProperty()
  @Length(64, 64)
  contentHash!: string;

  @ApiProperty({ type: [Number] })
  @IsArray()
  @IsNumber({}, { each: true })
  vector!: number[];
}

export class PutEmbeddingVectorsDto {
  @ApiProperty()
  @IsString()
  spaceId!: string;

  @ApiProperty({ type: [EmbeddingVectorDto], maxItems: 250 })
  @IsArray()
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => EmbeddingVectorDto)
  items!: EmbeddingVectorDto[];
}

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

  @ApiProperty()
  @Length(64, 64)
  contentHash!: string;
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
