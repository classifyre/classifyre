import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REQUEST_STATUSES } from './access-requests.service';

const SCOPE_TYPES = ['asset', 'source'] as const;
const DATA_ROLES = ['data-reader', 'data-reader-unmasked'] as const;

/** One access request (DQ §5.9). */
export class AccessRequestDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: SCOPE_TYPES })
  scopeType: 'asset' | 'source';

  @ApiProperty({ description: 'The table (asset) or source id.' })
  scopeId: string;

  @ApiProperty()
  sourceId: string;

  @ApiProperty({ example: 'customers' })
  targetName: string;

  @ApiPropertyOptional({ nullable: true, example: 'shop_lake.shop.customers' })
  sqlName: string | null;

  @ApiProperty({ example: 'user:5c1f…' })
  requesterRef: string;

  @ApiProperty()
  requesterName: string;

  @ApiProperty({ description: 'The group of the requester the grant goes to.' })
  groupId: string;

  @ApiProperty()
  groupName: string;

  @ApiPropertyOptional({ nullable: true })
  groupPath: string | null;

  @ApiProperty({ enum: DATA_ROLES })
  roleKey: string;

  @ApiProperty()
  reason: string;

  @ApiProperty()
  durationDays: number;

  @ApiProperty({ enum: REQUEST_STATUSES })
  status: string;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  decidedBy: string | null;

  @ApiPropertyOptional({ nullable: true })
  decidedByName: string | null;

  @ApiPropertyOptional({ nullable: true })
  decidedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  decisionNote: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'When the grant an approval gave ends.',
  })
  grantExpiresAt: Date | null;

  @ApiProperty({ description: 'You may approve or decline it now.' })
  canDecide: boolean;

  @ApiProperty({ description: 'It is yours and still waiting.' })
  canWithdraw: boolean;
}

export class AccessRequestTargetDto {
  @ApiProperty({ enum: SCOPE_TYPES })
  scopeType: 'asset' | 'source';

  @ApiProperty()
  id: string;

  @ApiProperty()
  sourceId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  sqlName: string | null;
}

export class AccessRequestGroupDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  path: string | null;
}

export class AccessRequestDeciderDto {
  @ApiProperty()
  ref: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ enum: ['OWNER', 'STEWARD'] })
  role: string;
}

/** What asking for access to one table or source looks like for you. */
export class AccessRequestOptionsDto {
  @ApiProperty({ type: AccessRequestTargetDto })
  target: AccessRequestTargetDto;

  @ApiProperty()
  canQuery: boolean;

  @ApiProperty()
  readsInClear: boolean;

  @ApiProperty({
    type: [AccessRequestGroupDto],
    description: 'Your groups: access is given to one of them.',
  })
  groups: AccessRequestGroupDto[];

  @ApiProperty({
    type: [AccessRequestDeciderDto],
    description:
      'Who decides: the owner, else the stewards; empty: the workspace admins.',
  })
  deciders: AccessRequestDeciderDto[];

  @ApiPropertyOptional({ type: AccessRequestDto, nullable: true })
  pending: AccessRequestDto | null;

  @ApiProperty({ type: [String], enum: DATA_ROLES })
  roles: string[];

  @ApiProperty()
  defaultDays: number;

  @ApiProperty()
  maxDays: number;
}

export class CreateAccessRequestDto {
  @ApiProperty({ enum: SCOPE_TYPES })
  scopeType: 'asset' | 'source';

  @ApiProperty()
  scopeId: string;

  @ApiProperty({ description: 'One of your groups.' })
  groupId: string;

  @ApiPropertyOptional({ enum: DATA_ROLES, default: 'data-reader' })
  roleKey?: string;

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  reason: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 365, default: 90 })
  durationDays?: number;
}

export class ApproveAccessRequestDto {
  @ApiPropertyOptional({
    enum: ['data-reader'],
    description: 'Give Data reader instead of the unmasked role asked for.',
  })
  roleKey?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  durationDays?: number;

  @ApiPropertyOptional()
  note?: string;
}

export class DenyAccessRequestDto {
  @ApiPropertyOptional({ description: 'Why, for the requester.' })
  note?: string;
}
