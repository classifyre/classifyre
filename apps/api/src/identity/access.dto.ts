import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CAPABILITY_IDS } from './capabilities';
import type { GrantScopeType } from './tenancy.service';

export class RoleDto {
  @ApiProperty({ example: 'investigator' })
  key: string;

  @ApiProperty({ example: 'Investigator' })
  title: string;

  @ApiProperty({
    enum: ['tenant', 'group', 'workspace'],
    isArray: true,
    description: 'Where this role can be granted.',
  })
  scopes: string[];

  @ApiProperty({ enum: CAPABILITY_IDS, isArray: true })
  capabilities: string[];
}

export class TenantGroupDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'workspace-managers' })
  name: string;

  @ApiProperty({ example: '/finance/workspace-managers' })
  path: string;

  @ApiProperty({ type: String, nullable: true })
  parentId: string | null;
}

export class CreateGrantDto {
  @ApiProperty({
    enum: ['group'],
    description:
      'Access always goes to a group; people get it by being in one.',
  })
  subjectType: 'group';

  @ApiProperty({ description: 'Group id.' })
  subjectId: string;

  @ApiProperty({ example: 'viewer' })
  roleKey: string;

  @ApiPropertyOptional({
    enum: ['tenant', 'group', 'workspace', 'source', 'asset'],
    description:
      'Tenant-level grants: where the role applies. Workspace grants are on that workspace, ' +
      'or with `source` / `asset` and `resourceId` on one source or table of it (data-reader only).',
  })
  scopeType?: GrantScopeType;

  @ApiPropertyOptional({
    description:
      'Workspace grants with scopeType `source` or `asset`: the source or asset id.',
  })
  resourceId?: string;

  @ApiPropertyOptional({
    description:
      'Tenant-level grants only: the tenant id, owner group id or workspace id.',
  })
  scopeId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the grant ends, e.g. for a contractor (U10).',
  })
  expiresAt?: string | null;
}

export class GrantDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['group'] })
  subjectType: 'group';

  @ApiProperty()
  subjectId: string;

  @ApiProperty({ example: '/finance' })
  subjectLabel: string;

  @ApiProperty({ example: 'viewer' })
  roleKey: string;

  @ApiProperty({ enum: ['tenant', 'group', 'workspace', 'source', 'asset'] })
  scopeType: string;

  @ApiProperty()
  scopeId: string;

  @ApiProperty({ example: 'Workspaces of /finance' })
  scopeLabel: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt: Date | null;

  @ApiPropertyOptional({
    description:
      'True when the grant comes from the tenant or an owning group rather than this workspace.',
  })
  inherited?: boolean;

  @ApiPropertyOptional({
    description: 'For a grant on one table: the source the table belongs to.',
  })
  sourceId?: string;
}

export class TenantDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'default' })
  alias: string;

  @ApiProperty({ example: 'Default' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The caller's own name, for the account menu; null for visitors.",
  })
  displayName: string | null;

  @ApiProperty({
    enum: CAPABILITY_IDS,
    isArray: true,
    description: 'What the caller may do across the whole tenant.',
  })
  capabilities: string[];

  @ApiProperty({
    description: 'The caller is also an operator: the Platform page is theirs.',
  })
  operator: boolean;

  @ApiProperty({
    description:
      'The caller has not signed in and is browsing the public tenant, read-only.',
  })
  visitor: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The tenant's organization in the identity server, for operators' links to its identity console; null for everyone else.",
  })
  organizationId: string | null;
}

/** One tenant the caller belongs to, for the account menu (§12.2). */
export class TenantMembershipDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'default' })
  alias: string;

  @ApiProperty({ example: 'Default' })
  name: string;

  @ApiProperty({
    description: 'True when this is the tenant of the current session.',
  })
  current: boolean;
}

export class TenantEventDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt: Date;

  @ApiProperty({ type: String, nullable: true })
  actor: string | null;

  @ApiProperty({ example: 'grant.added' })
  action: string;

  @ApiProperty({ type: Object })
  detail: Record<string, unknown>;
}

export enum TenantEventSortBy {
  OCCURRED_AT = 'OCCURRED_AT',
  ACTOR = 'ACTOR',
  ACTION = 'ACTION',
}

export enum TenantEventSortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

/** Tenant-level activity paging: filters and offset pages like the workspace trail. */
export class QueryTenantEventsDto {
  @ApiPropertyOptional({ example: 'grant.added' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({
    description:
      'Actor reference; resolve display names with GET /tenant/actors/resolve.',
  })
  @IsOptional()
  @IsString()
  actor?: string;

  @ApiPropertyOptional({
    description:
      'Free text over the action and its detail (group path, address, workspace slug).',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 100;

  @ApiPropertyOptional({
    enum: TenantEventSortBy,
    default: TenantEventSortBy.OCCURRED_AT,
  })
  @IsOptional()
  @IsIn(Object.values(TenantEventSortBy))
  sortBy?: TenantEventSortBy = TenantEventSortBy.OCCURRED_AT;

  @ApiPropertyOptional({
    enum: TenantEventSortOrder,
    default: TenantEventSortOrder.DESC,
  })
  @IsOptional()
  @IsIn(Object.values(TenantEventSortOrder))
  sortOrder?: TenantEventSortOrder = TenantEventSortOrder.DESC;
}

export class TenantEventsResponseDto {
  @ApiProperty({ type: [TenantEventDto] })
  items: TenantEventDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  skip: number;

  @ApiProperty()
  limit: number;
}
