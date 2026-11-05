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
    enum: CAPABILITY_IDS,
    isArray: true,
    description: 'What the caller may do across the whole tenant.',
  })
  capabilities: string[];

  @ApiProperty({
    description:
      'True when people and groups are managed here; false when a company directory or the identity server owns them and they are read-only.',
  })
  peopleManagement: boolean;
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

export class PersonDto {
  @ApiProperty({ description: 'The person’s id in the identity server.' })
  id: string;

  @ApiProperty({ example: 'ada@example.test' })
  username: string;

  @ApiProperty({ type: String, nullable: true })
  email: string | null;

  @ApiProperty({ type: String, nullable: true })
  firstName: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName: string | null;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty({
    description: 'Brought by the tenant’s company directory, not added here.',
  })
  fromDirectory: boolean;

  @ApiProperty({
    description:
      'Classifyre created this account, so it can set a temporary password and deletes the account when the person leaves.',
  })
  createdHere: boolean;

  @ApiProperty({
    type: [String],
    description: 'Groups the person is directly in.',
  })
  groupIds: string[];

  @ApiProperty()
  isYou: boolean;
}

export class AddPersonDto {
  @ApiProperty({ example: 'ada@example.test' })
  email: string;

  @ApiProperty({ example: 'Ada' })
  firstName: string;

  @ApiProperty({ example: 'Kowalczyk' })
  lastName: string;
}

export class AddedPersonDto {
  @ApiProperty({ type: PersonDto })
  person: PersonDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Only for a new account: shown once, changed by the person at first sign-in. Null when an existing account was added.',
  })
  temporaryPassword: string | null;
}

export class TemporaryPasswordDto {
  @ApiProperty({ description: 'Shown once; changed at first sign-in.' })
  temporaryPassword: string;
}

export class RemovedPersonDto {
  @ApiProperty({
    description:
      'The account was deleted too (Classifyre made it and it is in no other tenant).',
  })
  accountDeleted: boolean;
}

export class CreateGroupDto {
  @ApiProperty({ example: 'managers' })
  name: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Create it inside this group.',
  })
  parentId?: string | null;
}

export class RenameGroupDto {
  @ApiProperty({ example: 'finance' })
  name: string;
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
