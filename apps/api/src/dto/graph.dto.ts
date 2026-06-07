import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { EdgeOrigin } from '@prisma/client';

export type GraphDirection = 'both' | 'out' | 'in';

export class ExpandGraphDto {
  @ApiProperty({ description: 'Seed entity kind: "asset" | "finding"' })
  @IsString()
  entityType!: string;

  @ApiProperty({ description: 'Seed entity UUID' })
  @IsString()
  entityId!: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  depth?: number = 1;

  @ApiPropertyOptional({
    default: 'both',
    enum: ['both', 'out', 'in'],
  })
  @IsOptional()
  @IsIn(['both', 'out', 'in'])
  direction?: GraphDirection = 'both';

  @ApiPropertyOptional({
    description: 'Restrict traversal to these relation types',
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  relationTypes?: string[];
}

export class GraphNodeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: '"asset" | "finding"' })
  type!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ description: 'Hop distance from the seed/case evidence' })
  depth!: number;

  @ApiPropertyOptional()
  assetType?: string;

  @ApiPropertyOptional()
  sourceType?: string;

  @ApiPropertyOptional()
  severity?: string;

  @ApiPropertyOptional()
  detectorType?: string;

  @ApiPropertyOptional()
  status?: string;

  @ApiPropertyOptional({ description: 'True when the underlying row no longer exists' })
  missing?: boolean;
}

export class GraphEdgeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fromType!: string;

  @ApiProperty()
  fromId!: string;

  @ApiProperty()
  toType!: string;

  @ApiProperty()
  toId!: string;

  @ApiProperty()
  relationType!: string;

  @ApiProperty()
  confidence!: number;

  @ApiProperty({ enum: EdgeOrigin })
  origin!: EdgeOrigin;
}

export class GraphResponseDto {
  @ApiProperty({ type: [GraphNodeDto] })
  nodes!: GraphNodeDto[];

  @ApiProperty({ type: [GraphEdgeDto] })
  edges!: GraphEdgeDto[];

  @ApiProperty({ description: 'True when the node cap was hit and the graph is partial' })
  truncated!: boolean;
}

export class RebuildEdgesResponseDto {
  @ApiProperty({ description: 'Total edges present after the rebuild' })
  edgeCount!: number;
}
