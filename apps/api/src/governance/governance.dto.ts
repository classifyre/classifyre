import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GovernanceStatus, LegalBasis } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { GOVERNANCE_ROLES } from './governance-rules';

/** A person or group as the governance screens show it. */
export class GovernancePrincipalDto {
  @ApiProperty({ example: 'user:5c1f…' })
  ref: string;

  @ApiProperty({ enum: ['user', 'group'] })
  kind: 'user' | 'group';

  @ApiProperty({ example: 'Jordan Reyes' })
  displayName: string;

  @ApiPropertyOptional({ example: 'jordan@example.org' })
  email?: string;

  @ApiPropertyOptional({
    description: 'For a group: its path in the tenant.',
    example: '/finance/controlling',
  })
  path?: string;
}

export class GovernanceRoleDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: GOVERNANCE_ROLES })
  role: string;

  @ApiProperty({ type: GovernancePrincipalDto })
  principal: GovernancePrincipalDto;

  @ApiProperty({
    description: "Set on the asset's source, not on the asset itself.",
  })
  inherited: boolean;

  @ApiProperty()
  dateIn: Date;

  @ApiPropertyOptional({
    description: 'When the role ended; absent while open.',
  })
  dateOut?: Date;

  @ApiPropertyOptional()
  replacedByRef?: string;

  @ApiPropertyOptional()
  assignedBy?: string;

  @ApiPropertyOptional()
  removedBy?: string;
}

export class GovernanceChecklistItemDto {
  @ApiProperty({
    enum: ['owner', 'steward', 'description', 'meaning', 'certified'],
  })
  key: string;

  @ApiProperty()
  done: boolean;
}

export class AssetGovernanceDto {
  @ApiProperty()
  assetId: string;

  @ApiProperty()
  sourceId: string;

  @ApiProperty({
    description:
      'Whether someone owns the asset, itself or through its source.',
  })
  governed: boolean;

  @ApiPropertyOptional({
    enum: GovernanceStatus,
    nullable: true,
    description: 'Lifecycle; null while the asset is not governed.',
  })
  status: GovernanceStatus | null;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiPropertyOptional({ nullable: true })
  usage: string | null;

  @ApiPropertyOptional({ nullable: true })
  limitations: string | null;

  @ApiPropertyOptional({ enum: LegalBasis, nullable: true })
  legalBasis: LegalBasis | null;

  @ApiPropertyOptional({ nullable: true })
  retention: string | null;

  @ApiPropertyOptional({ nullable: true })
  certifiedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  certifiedBy: string | null;

  @ApiPropertyOptional({ nullable: true })
  updatedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  updatedBy: string | null;

  @ApiProperty({
    type: [GovernanceRoleDto],
    description: 'Open roles that apply: its own, else its source’s.',
  })
  roles: GovernanceRoleDto[];

  @ApiProperty({
    type: [GovernanceRoleDto],
    description: 'Ended roles of the asset, newest first.',
  })
  history: GovernanceRoleDto[];

  @ApiProperty({ type: [GovernanceChecklistItemDto] })
  checklist: GovernanceChecklistItemDto[];

  @ApiProperty({
    description:
      'Whether the caller may change it: asset.govern, or owner or steward of the asset or its source.',
  })
  canGovern: boolean;
}

export class SourceGovernanceCoverageDto {
  @ApiProperty()
  assets: number;

  @ApiProperty({ description: 'Assets with an owner, own or inherited.' })
  owned: number;

  @ApiProperty({ description: 'Owned assets whose lifecycle is ACTIVE.' })
  active: number;
}

export class SourceGovernanceDto {
  @ApiProperty()
  sourceId: string;

  @ApiProperty({ type: [GovernanceRoleDto] })
  roles: GovernanceRoleDto[];

  @ApiProperty({ type: [GovernanceRoleDto] })
  history: GovernanceRoleDto[];

  @ApiProperty({ type: SourceGovernanceCoverageDto })
  coverage: SourceGovernanceCoverageDto;

  @ApiProperty()
  canGovern: boolean;
}

export class UpdateAssetGovernanceDto {
  @ApiPropertyOptional({ nullable: true, description: 'Markdown.' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  usage?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  limitations?: string | null;

  @ApiPropertyOptional({ enum: LegalBasis, nullable: true })
  @IsOptional()
  @IsEnum(LegalBasis)
  legalBasis?: LegalBasis | null;

  @ApiPropertyOptional({ nullable: true, example: '10 y' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  retention?: string | null;

  @ApiPropertyOptional({
    enum: GovernanceStatus,
    description: 'ACTIVE certifies the asset; it needs an owner.',
  })
  @IsOptional()
  @IsEnum(GovernanceStatus)
  status?: GovernanceStatus;
}

export class AssignGovernanceRoleDto {
  @ApiProperty({ enum: GOVERNANCE_ROLES })
  @IsIn(GOVERNANCE_ROLES)
  role: (typeof GOVERNANCE_ROLES)[number];

  @ApiProperty({
    description:
      '`user:<id>` (owner, steward) or `group:<id>` (steward, custodian).',
  })
  @IsString()
  @MaxLength(200)
  principalRef: string;
}
