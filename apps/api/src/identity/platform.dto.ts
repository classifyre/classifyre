import { ApiProperty } from '@nestjs/swagger';

export class PlatformMeDto {
  @ApiProperty({
    description: 'Always true: the route answers only operators.',
  })
  operator: boolean;

  @ApiProperty({ type: String, nullable: true })
  name: string | null;
}

export class TenantAdminDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Ada Kowalczyk' })
  name: string;

  @ApiProperty({ type: String, nullable: true })
  email: string | null;
}

export class PlatformTenantDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'acme' })
  alias: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Its organization in the identity server; null once that is gone.',
  })
  organizationId: string | null;

  @ApiProperty({ example: 'Acme' })
  name: string;

  @ApiProperty({ enum: ['active', 'suspended', 'deleted'] })
  status: 'active' | 'suspended' | 'deleted';

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ description: 'Workspaces, soft-deleted ones not counted.' })
  workspaces: number;

  @ApiProperty({ description: 'People in the organization.' })
  members: number;

  @ApiProperty({ type: [TenantAdminDto] })
  admins: TenantAdminDto[];

  @ApiProperty({ type: Date, nullable: true })
  lastActivityAt: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "The tenant's own database; null until its first workspace.",
  })
  database: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why its last upgrade failed; its workspaces answer 503.',
  })
  upgradeError: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: [
      'ORGANIZATION_MISSING',
      'ORGANIZATION_REPLACED',
      'NO_ADMINS_GROUP',
      'UPGRADE_FAILED',
    ],
    description:
      'Why the tenant needs an operator: its organization was deleted or replaced in the identity server, it has no top-level `admins` group, or its database could not be upgraded.',
  })
  problem:
    | 'ORGANIZATION_MISSING'
    | 'ORGANIZATION_REPLACED'
    | 'NO_ADMINS_GROUP'
    | 'UPGRADE_FAILED'
    | null;
}

export class LocalWorkspaceDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;
}

export class ImportWorkspacesDto {
  @ApiProperty({ type: [String], example: ['finance-ledger'] })
  slugs: string[];
}

export class ImportedWorkspacesDto {
  @ApiProperty({
    type: [String],
    description: 'Copied into the tenant; the open database keeps them.',
  })
  copied: string[];
}
