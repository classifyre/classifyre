import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
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

  @ApiProperty({
    description:
      '"asset" | "finding" | "external". An "external" node names an object by ' +
      'its platform URN that no scan has produced yet — the far end of a ' +
      'cross-system lineage edge, drawn as a ghost until that source is scanned.',
  })
  type!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ description: 'Hop distance from the seed/case evidence' })
  depth!: number;

  @ApiPropertyOptional()
  assetType?: string;

  @ApiPropertyOptional()
  sourceType?: string;

  @ApiPropertyOptional({
    description:
      'Platform-qualified name of the underlying object, when known. On an ' +
      '"external" node this is also its id.',
  })
  urn?: string;

  @ApiPropertyOptional({ description: 'For asset nodes: parent source id' })
  sourceId?: string;

  @ApiPropertyOptional({
    description:
      'For asset nodes: the operator-facing name of the parent source (not its connector type)',
  })
  sourceName?: string;

  @ApiPropertyOptional()
  severity?: string;

  @ApiPropertyOptional()
  detectorType?: string;

  @ApiPropertyOptional({
    description: 'For CUSTOM findings: the custom detector display name',
  })
  customDetectorName?: string;

  @ApiPropertyOptional()
  status?: string;

  @ApiPropertyOptional({
    description: 'For finding nodes: truncated matched text',
  })
  matchedContent?: string;

  @ApiPropertyOptional({
    description: 'For finding nodes: name of the parent asset',
  })
  assetName?: string;

  @ApiPropertyOptional({ description: 'For finding nodes: parent asset id' })
  assetId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Hypothesis IDs this node is directly affiliated with (as evidence or case finding)',
  })
  hypothesisIds?: string[];

  @ApiPropertyOptional({
    description:
      'For finding nodes: the CaseFinding record ID (used to unlink)',
  })
  caseFindingId?: string;

  @ApiPropertyOptional({
    description: 'True when the underlying row no longer exists',
  })
  missing?: boolean;
}

export class FieldMappingDto {
  @ApiPropertyOptional({
    description:
      'The output column. Null means the dependency is indirect: the upstream ' +
      'shaped which rows came out (ORDER BY, WHERE, a join key) without feeding ' +
      'any particular output column. Recorded once against the dataset rather ' +
      'than fanned out across every column, which is the only reason indirect ' +
      'dependencies are affordable to keep at all.',
    nullable: true,
  })
  downstream?: string | null;

  @ApiProperty({ type: [String], description: 'Input columns it depends on' })
  upstreams!: string[];

  @ApiPropertyOptional({ description: 'The expression, when one is known' })
  transform?: string | null;

  @ApiPropertyOptional({
    description: 'IDENTITY | TRANSFORMED | AGGREGATED | INDIRECT',
  })
  type?: string;
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
    description:
      'True when this edge bridges nodes affiliated with different hypotheses',
  })
  crossHypothesis?: boolean;

  @ApiPropertyOptional({
    description:
      'What traversing this edge means: FLOW (lineage) | CONTAINMENT | IDENTITY | ' +
      'REFERENCE | USAGE. The lineage view walks FLOW only; CONTAINMENT collapses ' +
      'nodes into their parent and IDENTITY merges nodes that are the same thing twice.',
    enum: ['FLOW', 'CONTAINMENT', 'IDENTITY', 'REFERENCE', 'USAGE'],
  })
  relationClass?: string;

  @ApiPropertyOptional({
    description: 'DATASET | FIELD — whether column-level mappings are present',
  })
  granularity?: string;

  @ApiPropertyOptional({
    description:
      'How the edge was derived, which is how far it should be trusted: ' +
      'RUNTIME_OBSERVED | SYSTEM_CATALOG | SQL_PARSED | HEURISTIC | MANUAL',
  })
  method?: string;

  @ApiPropertyOptional({
    description:
      'Column-level dependencies. A null downstream is an indirect dependency ' +
      '(an ORDER BY, a join key) that shaped which rows came out without feeding ' +
      'any one output column.',
    type: [FieldMappingDto],
  })
  fieldMappings?: FieldMappingDto[];

  @ApiPropertyOptional({
    description: 'What this edge was read from: { sql, queryId, runId }',
    type: 'object',
    additionalProperties: true,
  })
  evidence?: Record<string, unknown>;
}

export class GraphResponseDto {
  @ApiProperty({ type: [GraphNodeDto] })
  nodes!: GraphNodeDto[];

  @ApiProperty({ type: [GraphEdgeDto] })
  edges!: GraphEdgeDto[];

  @ApiProperty({
    description: 'True when the node cap was hit and the graph is partial',
  })
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

  @ApiPropertyOptional({
    description: 'Source entity UUID (use fromId OR fromHash)',
  })
  @IsOptional()
  @IsString()
  fromId?: string;

  @ApiPropertyOptional({
    description:
      'Source asset hash (alternative to fromId — API resolves to UUID)',
  })
  @IsOptional()
  @IsString()
  fromHash?: string;

  @ApiProperty({ description: 'Target entity kind: "asset" | "finding"' })
  @IsString()
  toType!: string;

  @ApiPropertyOptional({
    description: 'Target entity UUID (use toId OR toHash)',
  })
  @IsOptional()
  @IsString()
  toId?: string;

  @ApiPropertyOptional({
    description:
      'Target asset hash (alternative to toId — API resolves to UUID)',
  })
  @IsOptional()
  @IsString()
  toHash?: string;

  @ApiPropertyOptional({
    description:
      'Target named by its platform URN (e.g. snowflake://acct/db/schema/table). ' +
      'Use instead of toId/toHash to point at an object owned by another source — ' +
      'including one that has not been scanned yet, which is kept and stitched later.',
  })
  @IsOptional()
  @IsString()
  toUrn?: string;

  @ApiPropertyOptional({
    description: 'Source named by its platform URN (see toUrn)',
  })
  @IsOptional()
  @IsString()
  fromUrn?: string;

  @ApiProperty({
    description:
      'Relation type: free-form. Flow subtypes TRANSFORM | VIEW | COPY | WRITE | EXPORT | SEND; ' +
      'also OWNS | ACCESSED | READS | ATTACHED_TO | EXECUTED | MENTIONS | CONTAINS | REFERENCES | FOREIGN_KEY',
  })
  @IsString()
  relationType!: string;

  @ApiPropertyOptional({
    description:
      'What traversing this edge means: FLOW (lineage) | CONTAINMENT | IDENTITY | REFERENCE | USAGE. ' +
      'Derived from relationType when omitted, so an older connector still classes correctly.',
    enum: ['FLOW', 'CONTAINMENT', 'IDENTITY', 'REFERENCE', 'USAGE'],
  })
  @IsOptional()
  @IsString()
  relationClass?: string;

  @ApiPropertyOptional({
    description: 'DATASET | FIELD — whether fieldMappings are present',
    enum: ['DATASET', 'FIELD'],
  })
  @IsOptional()
  @IsString()
  granularity?: string;

  @ApiPropertyOptional({
    description:
      'How the edge was derived, which is how far it should be trusted: ' +
      'RUNTIME_OBSERVED | SYSTEM_CATALOG | SQL_PARSED | HEURISTIC | MANUAL',
    enum: [
      'RUNTIME_OBSERVED',
      'SYSTEM_CATALOG',
      'SQL_PARSED',
      'HEURISTIC',
      'MANUAL',
    ],
  })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({
    description:
      'Column-level dependencies: [{ downstream, upstreams[], transform, type }]. ' +
      'A null downstream is an indirect dependency (ORDER BY, join key) recorded ' +
      'once against the dataset rather than fanned out across every output column.',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  @IsOptional()
  @IsArray()
  fieldMappings?: Record<string, unknown>[];

  @ApiPropertyOptional({
    description: 'What this edge was read from: { sql, queryId, runId }',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Asset hash of the job/query/notebook that moved the data',
  })
  @IsOptional()
  @IsString()
  viaId?: string;

  @ApiPropertyOptional({
    description: 'URN of the process that moved the data',
  })
  @IsOptional()
  @IsString()
  viaUrn?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class BulkIngestEdgesDto {
  @ApiPropertyOptional({
    description:
      'Which source the hashes belong to. An asset hash is only unique per source, ' +
      'so without this the API has to guess which of two assets sharing a hash an ' +
      'edge meant. Cross-source targeting goes through fromUrn/toUrn instead.',
  })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiProperty({ type: [IngestEdgeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestEdgeDto)
  edges!: IngestEdgeDto[];
}

export class BulkIngestEdgesResponseDto {
  @ApiProperty({ description: 'Number of edges upserted' })
  upserted!: number;

  @ApiPropertyOptional({
    description:
      'Edges whose endpoint named a URN that has not been ingested yet. Kept as ' +
      'an "external" endpoint and bound once that source is scanned, in either order.',
  })
  external?: number;

  @ApiPropertyOptional({
    description:
      'Edges thrown away because an endpoint could not be resolved at all. ' +
      'Reported so silent edge loss is visible in the run log.',
  })
  dropped?: number;
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
    description:
      'Relation type — free-form string (e.g. "READS", "SENT_TO", "my custom link")',
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

export class LineageGraphDto {
  @ApiProperty({ description: 'Asset to trace from' })
  @IsString()
  assetId!: string;

  @ApiPropertyOptional({
    description:
      '"up" for where this came from, "down" for what breaks if it changes, ' +
      '"both" for the full picture. Flow edges point the way the data moves, so ' +
      'upstream is an inward walk.',
    enum: ['up', 'down', 'both'],
    default: 'both',
  })
  @IsOptional()
  @IsIn(['up', 'down', 'both'])
  direction?: 'up' | 'down' | 'both';

  @ApiPropertyOptional({ minimum: 1, maximum: 3, default: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  depth?: number;

  @ApiPropertyOptional({
    description:
      'Roll each node up into its container (table -> schema, chart -> dashboard). ' +
      'Containment is never a hop in a lineage path; it is what the path is ' +
      'collapsed *by*, which is how 400 tables become 12 schemas without losing an edge.',
    default: false,
  })
  @IsOptional()
  collapseContainers?: boolean;

  @ApiPropertyOptional({
    description:
      'Merge nodes joined by an IDENTITY edge into one, instead of drawing the ' +
      'IDENTITY edge itself. Useful when a dbt model and the warehouse table it ' +
      'is would otherwise show up as two hops in every path that crosses them — ' +
      'but off by default, because lineage now walks IDENTITY/REFERENCE edges as ' +
      'first-class hops (a cross-source SAME_AS match is exactly the kind of ' +
      'thing this view exists to surface, not fold away).',
    default: false,
  })
  @IsOptional()
  mergeIdentity?: boolean;
}

export class ColumnLineageDto {
  @ApiProperty()
  @IsString()
  assetId!: string;

  @ApiProperty({ description: 'The column to trace back' })
  @IsString()
  column!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  depth?: number;
}

export class ColumnLineageStepDto {
  @ApiProperty({ description: 'The asset the upstream columns live in' })
  assetId!: string;

  @ApiProperty()
  assetLabel!: string;

  @ApiPropertyOptional({
    description: 'Set when the upstream is not yet ingested',
  })
  urn?: string;

  @ApiProperty({ description: 'The column being explained at this step' })
  column!: string;

  @ApiProperty({ type: [String], description: 'Columns it was computed from' })
  upstreams!: string[];

  @ApiPropertyOptional()
  transform?: string | null;

  @ApiProperty({
    description: 'IDENTITY | TRANSFORMED | AGGREGATED | INDIRECT',
  })
  type!: string;

  @ApiProperty({ description: 'Hops from the column asked about' })
  depth!: number;
}

export class ColumnLineageResponseDto {
  @ApiProperty({ type: [ColumnLineageStepDto] })
  steps!: ColumnLineageStepDto[];

  @ApiProperty({
    type: [ColumnLineageStepDto],
    description:
      'Dependencies that shaped which rows came out (ORDER BY, WHERE, join keys) ' +
      "without feeding this column's values. Kept separate so they do not read " +
      'as if the column was computed from them.',
  })
  indirect!: ColumnLineageStepDto[];
}

export class RelationTypeDto {
  @ApiProperty()
  type!: string;

  @ApiProperty({
    description: 'FLOW | CONTAINMENT | IDENTITY | REFERENCE | USAGE',
  })
  relationClass!: string;

  @ApiPropertyOptional({ description: 'Edges currently carrying this type' })
  count?: number;
}

export class RelationTypesResponseDto {
  @ApiProperty({
    type: [String],
    description: 'All relation types in use, sorted by frequency',
  })
  inUse!: string[];

  @ApiProperty({
    type: [String],
    description: 'Vocabulary suggestions (built-in + inUse)',
  })
  suggestions!: string[];

  @ApiPropertyOptional({
    type: [RelationTypeDto],
    description:
      'Every suggestion with the class it belongs to, so the UI can group by ' +
      'question ("what flows", "who touched it") instead of by raw string. ' +
      'Served rather than hard-coded in the client: the vocabulary is open, and ' +
      'a TS enum would drift from the database the first time a connector added a subtype.',
  })
  classified?: RelationTypeDto[];
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
