import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CLASSIFICATIONS } from '../governance/governance-rules';

const STATES = ['live', 'blocked', 'unavailable', 'retired'] as const;
const AUDIENCE_ROLES = ['data-reader', 'data-reader-unmasked'] as const;

/** A person or group named on a shared dataset. */
export class SharedDatasetActorDto {
  @ApiProperty({ example: 'user:5c1f…' })
  ref: string;

  @ApiProperty()
  name: string;
}

export class SharedDatasetGroupDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: '/finance' })
  name: string;
}

/** One input column an output column comes from. */
export class SharedDatasetUpstreamDto {
  @ApiProperty()
  assetId: string;

  @ApiProperty({ example: 'shop_lake.shop.customers' })
  table: string;

  @ApiProperty()
  column: string;
}

/** An output column of a shared dataset, with what it inherits (DQ §5.12). */
export class SharedDatasetColumnDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  type: string;

  @ApiPropertyOptional({
    nullable: true,
    enum: CLASSIFICATIONS,
    description:
      'The strictest classification of the input columns it comes from: the least it is guarded.',
  })
  floor: string | null;

  @ApiProperty({
    type: [SharedDatasetUpstreamDto],
    description: 'The input columns that set the floor.',
  })
  from: SharedDatasetUpstreamDto[];

  @ApiProperty({ type: [SharedDatasetUpstreamDto] })
  upstreams: SharedDatasetUpstreamDto[];

  @ApiProperty({
    description:
      'False when lineage could not say where it comes from: it then takes the strictest classification of every input.',
  })
  traced: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 'AGGREGATED',
    description: 'IDENTITY, MAPPED, TRANSFORMED or AGGREGATED.',
  })
  transform: string | null;
}

/** A table a shared dataset reads. */
export class SharedDatasetInputDto {
  @ApiProperty()
  assetId: string;

  @ApiProperty({ example: 'shop_lake.shop.orders' })
  sqlName: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  sourceId: string;

  @ApiProperty()
  sourceName: string;

  @ApiProperty({
    type: [SharedDatasetActorDto],
    description:
      'Its owners, else its stewards: told of the dataset, and may block it.',
  })
  answeredBy: SharedDatasetActorDto[];

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Whether the owning group may query it now (null: no group given).',
  })
  groupCanQuery: boolean | null;

  @ApiProperty({ description: 'You own or steward it, or its source.' })
  youGovern: boolean;

  @ApiProperty({ description: 'It (or its source) blocks the dataset.' })
  blocked: boolean;
}

export class SharedDatasetSummaryDto {
  @ApiProperty({ description: 'The dataset is this asset.' })
  assetId: string;

  @ApiProperty({ example: 'shared.sales.orders_by_region' })
  sqlName: string;

  @ApiProperty()
  domain: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiProperty({ type: SharedDatasetGroupDto })
  owningGroup: SharedDatasetGroupDto;

  @ApiPropertyOptional({ type: SharedDatasetActorDto, nullable: true })
  owner: SharedDatasetActorDto | null;

  @ApiProperty({
    example: 'ACTIVE',
    description: 'GOV lifecycle: ACTIVE is Certified.',
  })
  lifecycle: string;

  @ApiProperty({ description: 'Its owner or a steward says it is ready.' })
  promoted: boolean;

  @ApiProperty({ enum: STATES })
  state: 'live' | 'blocked' | 'unavailable' | 'retired';

  @ApiPropertyOptional({ nullable: true })
  stateReason: string | null;

  @ApiProperty()
  inputCount: number;

  @ApiProperty({ description: 'You may query it.' })
  canQuery: boolean;

  @ApiProperty()
  version: number;

  @ApiProperty()
  updatedAt: Date;
}

export class SharedDatasetDto extends SharedDatasetSummaryDto {
  @ApiProperty()
  sql: string;

  @ApiProperty({ example: 'query' })
  kind: string;

  @ApiProperty({ description: 'The built-in Shared datasets source.' })
  sourceId: string;

  @ApiPropertyOptional({ nullable: true })
  promotedAt: Date | null;

  @ApiPropertyOptional({ type: SharedDatasetActorDto, nullable: true })
  promotedBy: SharedDatasetActorDto | null;

  @ApiProperty({ type: [SharedDatasetInputDto] })
  inputs: SharedDatasetInputDto[];

  @ApiProperty({ type: [SharedDatasetColumnDto] })
  columns: SharedDatasetColumnDto[];

  @ApiPropertyOptional({ type: SharedDatasetActorDto, nullable: true })
  createdBy: SharedDatasetActorDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  canEdit: boolean;

  @ApiProperty()
  canPromote: boolean;
}

export class DescribeSharedDatasetDto {
  @ApiProperty()
  sql: string;

  @ApiPropertyOptional({ description: 'Check the owning group’s access too.' })
  owningGroupId?: string;
}

export class SharedDatasetDescriptionDto {
  @ApiProperty({ type: [SharedDatasetColumnDto] })
  columns: SharedDatasetColumnDto[];

  @ApiProperty({ type: [SharedDatasetInputDto] })
  inputs: SharedDatasetInputDto[];

  @ApiProperty({ type: [String] })
  untraced: string[];

  @ApiProperty()
  canShare: boolean;

  @ApiProperty({ type: [String] })
  problems: string[];
}

export class SharedDatasetAudienceDto {
  @ApiProperty()
  groupId: string;

  @ApiPropertyOptional({ enum: AUDIENCE_ROLES, default: 'data-reader' })
  roleKey?: string;
}

export class CreateSharedDatasetDto {
  @ApiProperty({ example: 'orders_by_region' })
  name: string;

  @ApiProperty({ example: 'sales' })
  domain: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  sql: string;

  @ApiProperty({ description: 'The group whose rights read the inputs.' })
  owningGroupId: string;

  @ApiPropertyOptional({ type: [SharedDatasetAudienceDto] })
  audience?: SharedDatasetAudienceDto[];
}

export class UpdateSharedDatasetDto {
  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional()
  sql?: string;

  @ApiPropertyOptional()
  owningGroupId?: string;
}

export class PromoteSharedDatasetDto {
  @ApiProperty()
  promoted: boolean;
}

export class SharedDatasetVersionDto {
  @ApiProperty()
  version: number;

  @ApiProperty()
  sql: string;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiProperty({ type: SharedDatasetGroupDto })
  owningGroup: SharedDatasetGroupDto;

  @ApiProperty({ type: [String] })
  inputs: string[];

  @ApiPropertyOptional({ type: SharedDatasetActorDto, nullable: true })
  changedBy: SharedDatasetActorDto | null;

  @ApiProperty()
  createdAt: Date;
}

export class SharedDatasetBlockDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['asset', 'source'] })
  scopeType: string;

  @ApiPropertyOptional({ nullable: true })
  reason: string | null;

  @ApiPropertyOptional({ type: SharedDatasetActorDto, nullable: true })
  blockedBy: SharedDatasetActorDto | null;

  @ApiProperty()
  blockedAt: Date;
}

/** A shared dataset that reads a table, as its owners see it. */
export class SharedDatasetUseDto {
  @ApiProperty()
  datasetId: string;

  @ApiProperty()
  sqlName: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ type: SharedDatasetActorDto, nullable: true })
  owner: SharedDatasetActorDto | null;

  @ApiProperty({ type: SharedDatasetGroupDto })
  owningGroup: SharedDatasetGroupDto;

  @ApiPropertyOptional({ type: SharedDatasetBlockDto, nullable: true })
  block: SharedDatasetBlockDto | null;

  @ApiProperty({ description: 'Reads of this table through it in 30 days.' })
  reads30d: number;

  @ApiProperty()
  canBlock: boolean;
}

export class BlockSharedDatasetDto {
  @ApiProperty({ enum: ['asset', 'source'] })
  scopeType: string;

  @ApiProperty()
  scopeId: string;

  @ApiPropertyOptional()
  reason?: string;
}

export class SharedDatasetOptionsDto {
  @ApiProperty({
    description:
      'You may share datasets here (by role, or over tables you govern).',
  })
  canShare: boolean;

  @ApiProperty({
    description: 'Through the Dataset publisher role (or one above it).',
  })
  viaRole: boolean;

  @ApiProperty({
    type: [SharedDatasetGroupDto],
    description: 'Your groups: an owning group is one of them.',
  })
  groups: SharedDatasetGroupDto[];

  @ApiProperty({ type: [String] })
  domains: string[];
}
