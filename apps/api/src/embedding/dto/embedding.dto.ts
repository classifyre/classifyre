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
