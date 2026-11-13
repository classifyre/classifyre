import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AuditChangeDto {
  @ApiProperty({ example: 'Owner' })
  field: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  from?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  to?: string | null;
}

export class AuditEventDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt: Date;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Actor reference; resolve it with GET /actors/resolve.',
    example: 'mcp:2c7b9260-cc88-45f8-9459-defe4a662708',
  })
  actor: string | null;

  @ApiProperty({ example: 'mcp-token' })
  via: string;

  @ApiProperty({ enum: ['rest', 'mcp'] })
  channel: string;

  @ApiProperty({ example: 'source.manage' })
  capability: string;

  @ApiProperty({ example: 'PUT /sources/:id' })
  operation: string;

  @ApiProperty({ type: String, nullable: true, example: 'sources' })
  entityType: string | null;

  @ApiProperty({ type: String, nullable: true })
  entityId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Display name of the entity at record time (source/table name, group path, workspace slug).',
  })
  entityName: string | null;

  @ApiProperty({
    type: [String],
    description: 'Top-level input keys of the change, never their values.',
  })
  fields: string[];

  @ApiPropertyOptional({
    type: [AuditChangeDto],
    nullable: true,
    description:
      'What changed, for changes whose values are not secret (governance).',
  })
  changes?: AuditChangeDto[] | null;

  @ApiProperty({ type: Number, nullable: true })
  status: number | null;
}

export enum AuditEventSortBy {
  OCCURRED_AT = 'OCCURRED_AT',
  ACTOR = 'ACTOR',
  OPERATION = 'OPERATION',
  ENTITY_TYPE = 'ENTITY_TYPE',
  CAPABILITY = 'CAPABILITY',
}

export enum AuditEventSortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

/**
 * Workspace audit trail paging (docs/prd/IAM-access-management.md §11.1).
 * Offset paging: the trail is append-only in practice and callers page a
 * dense table, so `skip`/`take` match every other list endpoint; the old
 * keyset `before` stays for the "load more" callers that already send it.
 */
export class AuditEventsPageDto {
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({
    enum: AuditEventSortBy,
    default: AuditEventSortBy.OCCURRED_AT,
  })
  @IsOptional()
  @IsIn(Object.values(AuditEventSortBy))
  sortBy?: AuditEventSortBy = AuditEventSortBy.OCCURRED_AT;

  @ApiPropertyOptional({
    enum: AuditEventSortOrder,
    default: AuditEventSortOrder.DESC,
  })
  @IsOptional()
  @IsIn(Object.values(AuditEventSortOrder))
  sortOrder?: AuditEventSortOrder = AuditEventSortOrder.DESC;
}

export class QueryAuditEventsDto {
  @ApiPropertyOptional({ example: 'sources' })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional({
    description:
      'Actor reference; resolve display names with GET /actors/resolve.',
  })
  @IsOptional()
  @IsString()
  actor?: string;

  @ApiPropertyOptional({ example: 'source.manage' })
  @IsOptional()
  @IsString()
  capability?: string;

  @ApiPropertyOptional({ example: 'PUT /sources/:id' })
  @IsOptional()
  @IsString()
  operation?: string;

  @ApiPropertyOptional({ example: 'sources' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description:
      'Return events older than this id\u2019s event (keyset paging for "load more").',
  })
  @IsOptional()
  @IsString()
  before?: string;

  @ApiPropertyOptional({ type: AuditEventsPageDto })
  @IsOptional()
  @Type(() => AuditEventsPageDto)
  page?: AuditEventsPageDto;
}

export class AuditEventsResponseDto {
  @ApiProperty({ type: [AuditEventDto] })
  items: AuditEventDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  skip: number;

  @ApiProperty()
  limit: number;
}

export class ResolvedActorDto {
  @ApiProperty()
  ref: string;

  @ApiProperty({ enum: ['user', 'group', 'mcp', 'agent', 'system', 'name'] })
  kind: string;

  @ApiProperty({ example: 'Jordan Reyes' })
  displayName: string;

  @ApiPropertyOptional({
    description: 'For an action delegated through an MCP token: the token.',
  })
  viaDisplayName?: string;

  @ApiPropertyOptional({
    description: 'For a group: its path in the tenant.',
    example: '/finance/controlling',
  })
  path?: string;
}
