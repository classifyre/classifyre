import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CAPABILITY_IDS } from './capabilities';

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
  scopeType?: 'tenant' | 'group' | 'workspace';

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
    enum: CAPABILITY_IDS,
    isArray: true,
    description: 'What the caller may do across the whole tenant.',
  })
  capabilities: string[];
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
