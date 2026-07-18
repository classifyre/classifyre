import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { GlossaryEntityType } from '@prisma/client';

export class ListGlossaryQueryDto {
  @ApiPropertyOptional({
    description: 'Free-text filter over term, aliases and notes (ILIKE).',
  })
  @IsOptional()
  @IsString()
  query?: string;

  @ApiPropertyOptional({ enum: GlossaryEntityType })
  @IsOptional()
  @IsEnum(GlossaryEntityType)
  entityType?: GlossaryEntityType;

  @ApiPropertyOptional({ default: 25, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number = 25;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;
}

export class LookupGlossaryQueryDto {
  @ApiProperty({ description: 'Name or alias to resolve.' })
  @IsString()
  query!: string;

  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}

export class UpsertGlossaryTermDto {
  @ApiPropertyOptional({
    description: 'Existing row ID when editing or renaming',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  term!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  aliases?: string[];

  @ApiPropertyOptional({ enum: GlossaryEntityType })
  @IsOptional()
  @IsEnum(GlossaryEntityType)
  entityType?: GlossaryEntityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refId?: string;

  @ApiPropertyOptional({
    description:
      'Operator identity recorded as verifiedBy. Defaults to "operator".',
  })
  @IsOptional()
  @IsString()
  author?: string;
}

export class GlossaryTermDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  term!: string;

  @ApiProperty({ type: [String] })
  aliases!: string[];

  @ApiProperty({
    type: [String],
    description: 'Unverified aliases suggested by agents for operator review',
  })
  proposedAliases!: string[];

  @ApiProperty({ enum: GlossaryEntityType })
  entityType!: GlossaryEntityType;

  @ApiPropertyOptional({ nullable: true })
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true })
  refType?: string | null;

  @ApiPropertyOptional({ nullable: true })
  refId?: string | null;

  @ApiProperty({ description: 'AGENT proposals are unverified hypotheses' })
  origin!: string;

  @ApiProperty()
  verified!: boolean;

  @ApiPropertyOptional({ nullable: true })
  verifiedBy?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class UpsertGlossaryTermResponseDto extends GlossaryTermDto {
  @ApiPropertyOptional({
    description:
      'True when an agent alias proposal was stored for an operator-owned term',
  })
  merged?: boolean;
}

export class GlossaryListResponseDto {
  @ApiProperty({ type: [GlossaryTermDto] })
  terms!: GlossaryTermDto[];

  @ApiProperty()
  total!: number;
}

export class GlossaryLookupHitDto extends GlossaryTermDto {
  @ApiProperty({ enum: ['exact', 'alias', 'semantic'] })
  matchType!: 'exact' | 'alias' | 'semantic';

  @ApiPropertyOptional({ minimum: -1, maximum: 1 })
  similarity?: number;
}

export class DeleteGlossaryTermResponseDto {
  @ApiProperty()
  deleted!: boolean;

  @ApiProperty()
  id!: string;
}

export class VerifyGlossaryTermDto {
  @ApiPropertyOptional({
    description:
      'Operator identity recorded as verifiedBy. Defaults to "operator".',
  })
  @IsOptional()
  @IsString()
  verifiedBy?: string;
}
