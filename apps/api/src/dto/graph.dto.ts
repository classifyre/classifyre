import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
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

  @ApiPropertyOptional({ description: 'For finding nodes: truncated matched text' })
  matchedContent?: string;

  @ApiPropertyOptional({ description: 'For finding nodes: name of the parent asset' })
  assetName?: string;

  @ApiPropertyOptional({ description: 'For finding nodes: parent asset id' })
  assetId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Hypothesis IDs this node is directly affiliated with (as evidence or case finding)',
  })
  hypothesisIds?: string[];

  @ApiPropertyOptional({ description: 'For finding nodes: the CaseFinding record ID (used to unlink)' })
  caseFindingId?: string;

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

  @ApiPropertyOptional({
    description: 'True when this edge bridges nodes affiliated with different hypotheses',
  })
  crossHypothesis?: boolean;
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

/**
 * Phase 1: bulk-upsert of source-derived edges from a CLI connector.
 * Each entry is idempotent via the unique constraint on (fromType, fromId, toType, toId, relationType).
 *
 * Supported relation types: OWNS, ACCESSED, READS, WRITES, GENERATED_FROM,
 * EXPORTED_TO, ATTACHED_TO, SENT_TO, EXECUTED, MENTIONS, CONTAINS, REFERENCES.
 */
export class IngestEdgeDto {
  @ApiProperty({ description: 'Source entity kind: "asset" | "finding"' })
  @IsString()
  fromType!: string;

  @ApiPropertyOptional({ description: 'Source entity UUID (use fromId OR fromHash)' })
  @IsOptional()
  @IsString()
  fromId?: string;

  @ApiPropertyOptional({ description: 'Source asset hash (alternative to fromId — API resolves to UUID)' })
  @IsOptional()
  @IsString()
  fromHash?: string;

  @ApiProperty({ description: 'Target entity kind: "asset" | "finding"' })
  @IsString()
  toType!: string;

  @ApiPropertyOptional({ description: 'Target entity UUID (use toId OR toHash)' })
  @IsOptional()
  @IsString()
  toId?: string;

  @ApiPropertyOptional({ description: 'Target asset hash (alternative to toId — API resolves to UUID)' })
  @IsOptional()
  @IsString()
  toHash?: string;

  @ApiProperty({
    description: 'Relation type: OWNS | ACCESSED | READS | WRITES | GENERATED_FROM | EXPORTED_TO | ATTACHED_TO | SENT_TO | EXECUTED | MENTIONS | CONTAINS | REFERENCES',
  })
  @IsString()
  relationType!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class BulkIngestEdgesDto {
  @ApiProperty({ type: [IngestEdgeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestEdgeDto)
  edges!: IngestEdgeDto[];
}

export class BulkIngestEdgesResponseDto {
  @ApiProperty({ description: 'Number of edges upserted' })
  upserted!: number;
}

export class CreateManualEdgeDto {
  @ApiProperty({ description: 'Source entity kind: "asset" | "finding"' })
  @IsString()
  fromType!: string;

  @ApiProperty({ description: 'Source entity UUID' })
  @IsString()
  fromId!: string;

  @ApiProperty({ description: 'Target entity kind: "asset" | "finding"' })
  @IsString()
  toType!: string;

  @ApiProperty({ description: 'Target entity UUID' })
  @IsString()
  toId!: string;

  @ApiProperty({
    description: 'Relation type — free-form string (e.g. "READS", "SENT_TO", "my custom link")',
  })
  @IsString()
  relationType!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class UpdateEdgeDto {
  @ApiProperty({ description: 'New relation type label for this edge' })
  @IsString()
  relationType!: string;
}

export class EdgeDetailDto {
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

  @ApiProperty({ enum: ['INFERRED', 'SOURCE_DERIVED', 'MANUAL'] })
  origin!: string;
}

export class RelationTypesResponseDto {
  @ApiProperty({ type: [String], description: 'All relation types in use, sorted by frequency' })
  inUse!: string[];

  @ApiProperty({ type: [String], description: 'Vocabulary suggestions (built-in + inUse)' })
  suggestions!: string[];
}

/**
 * Phase 2: named pivot questions on a graph node (Palantir-style).
 * Returns the subgraph answering the chosen question.
 */
export class PivotGraphDto {
  @ApiProperty({ description: 'Entity kind: "asset" | "finding"' })
  @IsString()
  entityType!: string;

  @ApiProperty({ description: 'Entity UUID' })
  @IsString()
  entityId!: string;

  @ApiProperty({
    enum: [
      'who_touched',
      'upstream_lineage',
      'downstream_lineage',
      'access',
      'emails',
      'similar_findings',
    ],
    description: 'Named investigation question',
  })
  @IsString()
  pivot!: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  depth?: number;
}
