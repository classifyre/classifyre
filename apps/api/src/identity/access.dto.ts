import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ enum: ['group', 'user'] })
  subjectType: 'group' | 'user';

  @ApiProperty({ description: 'Group id, or the person’s subject id.' })
  subjectId: string;

  @ApiProperty({ example: 'viewer' })
  roleKey: string;

  @ApiPropertyOptional({
    enum: ['tenant', 'group', 'workspace'],
    description:
      'Tenant-level grants only: where the role applies. Workspace grants are always on that workspace.',
  })
  scopeType?: GrantScopeType;

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

  @ApiProperty({ enum: ['group', 'user'] })
  subjectType: string;

  @ApiProperty()
  subjectId: string;

  @ApiProperty({ example: '/finance' })
  subjectLabel: string;

  @ApiProperty({ example: 'viewer' })
  roleKey: string;

  @ApiProperty({ enum: ['tenant', 'group', 'workspace'] })
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
