import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CaseKind,
  CaseStatus,
  DataRequestDeliveryMode,
  DataRequestState,
  Severity,
} from '@prisma/client';

export class DataRequestGroupRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class DataRequestActorRefDto {
  @ApiProperty()
  ref!: string;

  @ApiProperty()
  name!: string;
}

export class DataRequestOptionsDto {
  @ApiProperty({ type: [DataRequestGroupRefDto] })
  routeGroups!: DataRequestGroupRefDto[];

  @ApiProperty({ type: [DataRequestGroupRefDto] })
  audienceGroups!: DataRequestGroupRefDto[];

  @ApiProperty()
  canSelfServe!: boolean;
}

export class CreateDataRequestDto {
  @ApiProperty()
  title!: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional({ enum: Severity, default: Severity.MEDIUM })
  priority?: Severity;

  @ApiProperty()
  routeGroupId!: string;

  @ApiProperty()
  audienceGroupId!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  spec?: Record<string, unknown>;
}

export class UpdateDataRequestSpecDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  spec!: Record<string, unknown>;

  @ApiProperty()
  baseVersion!: number;

  @ApiPropertyOptional()
  clientId?: string;
}

export class UpdateDataRequestSqlDto {
  @ApiPropertyOptional()
  sql?: string;

  @ApiPropertyOptional()
  regenerate?: boolean;

  @ApiProperty()
  baseVersion!: number;

  @ApiPropertyOptional()
  clientId?: string;
}

export class ClaimDataRequestDto {
  @ApiPropertyOptional()
  assigneeRef?: string;
}

export class RerouteDataRequestDto {
  @ApiProperty()
  groupId!: string;
}

export class DeliverDataRequestDto {
  @ApiProperty()
  datasetAssetId!: string;

  @ApiPropertyOptional()
  note?: string;
}

export class RequestChangesDto {
  @ApiProperty()
  reason!: string;
}

export class DeclineDataRequestDto {
  @ApiProperty()
  reason!: string;
}

export class AddDataRequestCommentDto {
  @ApiProperty()
  body!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  anchor?: { tableId: string; column?: string } | null;

  @ApiPropertyOptional()
  x?: number;

  @ApiPropertyOptional()
  y?: number;
}

export class AddDataRequestCommentReplyDto {
  @ApiProperty()
  body!: string;
}

export class ResolveDataRequestCommentDto {
  @ApiProperty()
  resolved!: boolean;
}

export class DataRequestPinAnchorDto {
  @ApiProperty()
  tableId!: string;

  @ApiPropertyOptional()
  column?: string;
}

export class DataRequestPinDto {
  @ApiProperty()
  threadId!: string;

  @ApiPropertyOptional({ type: DataRequestPinAnchorDto, nullable: true })
  anchor!: DataRequestPinAnchorDto | null;

  @ApiProperty()
  x!: number;

  @ApiProperty()
  y!: number;
}

export class DataRequestDeliveryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  round!: number;

  @ApiProperty()
  datasetAssetId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  datasetName!: string | null;

  @ApiProperty()
  datasetVersion!: number;

  @ApiProperty()
  sqlSnapshot!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  specSnapshot!: Record<string, unknown>;

  @ApiProperty({ enum: DataRequestDeliveryMode })
  mode!: DataRequestDeliveryMode;

  @ApiProperty({ type: DataRequestActorRefDto })
  deliveredBy!: DataRequestActorRefDto;

  @ApiPropertyOptional({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export type LiveDatasetStatus =
  | 'ok'
  | 'retired'
  | 'blocked'
  | 'unavailable'
  | 'removed';

export class DataRequestLiveDatasetDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  assetId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  sqlName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  domain!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  name!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  currentVersion!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  deliveredVersion!: number | null;

  @ApiProperty({
    enum: ['ok', 'retired', 'blocked', 'unavailable', 'removed'],
  })
  status!: LiveDatasetStatus;

  @ApiPropertyOptional({ type: String, nullable: true })
  reason!: string | null;
}

export class DataRequestCheckTableDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  assetId!: string | null;

  @ApiProperty()
  sqlName!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  sourceId!: string | null;

  @ApiProperty()
  exists!: boolean;

  @ApiProperty()
  groupCanQuery!: boolean;

  @ApiProperty({ type: [String] })
  maskedColumns!: string[];

  @ApiProperty()
  hiddenColumnCount!: number;
}

export class DataRequestCheckResultDto {
  @ApiProperty()
  ok!: boolean;

  @ApiProperty()
  sql!: string;

  @ApiProperty({ type: DataRequestGroupRefDto })
  routeGroup!: DataRequestGroupRefDto;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  precheckError!: { code: string; message: string } | null;

  @ApiProperty({ type: [Object] })
  diagnostics!: Array<Record<string, unknown>>;

  @ApiProperty({ type: [DataRequestCheckTableDto] })
  tables!: DataRequestCheckTableDto[];

  @ApiProperty({ type: [String] })
  problems!: string[];
}

export class DataRequestDescribeResultDto {
  @ApiProperty()
  cached!: boolean;

  @ApiProperty()
  sqlHash!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  describe!: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  error!: { code: string; message: string } | null;

  @ApiProperty({ type: DataRequestCheckResultDto })
  check!: DataRequestCheckResultDto;
}

export class DataRequestCommentThreadDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  createdBy!: string | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  resolvedAt!: Date | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  resolvedBy!: string | null;

  @ApiProperty()
  entryCount!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class AddDataRequestCommentResponseDto {
  @ApiProperty({ type: DataRequestCommentThreadDto })
  thread!: DataRequestCommentThreadDto;

  @ApiProperty({ type: DataRequestPinDto })
  pin!: DataRequestPinDto;

  @ApiProperty()
  specVersion!: number;
}

export class ResolveDataRequestCommentResponseDto {
  @ApiProperty()
  changed!: boolean;

  @ApiProperty()
  caseId!: string;

  @ApiProperty()
  title!: string;
}

export class DataRequestListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CaseKind })
  kind!: CaseKind;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ enum: CaseStatus })
  status!: CaseStatus;

  @ApiProperty({ enum: Severity })
  priority!: Severity;

  @ApiProperty({ enum: DataRequestState })
  state!: DataRequestState;

  @ApiProperty({ type: DataRequestActorRefDto })
  requester!: DataRequestActorRefDto;

  @ApiProperty({ type: DataRequestGroupRefDto })
  routeGroup!: DataRequestGroupRefDto;

  @ApiProperty({ type: DataRequestGroupRefDto })
  audienceGroup!: DataRequestGroupRefDto;

  @ApiPropertyOptional({ type: DataRequestActorRefDto, nullable: true })
  assignee!: DataRequestActorRefDto | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  datasetAssetId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  datasetName!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  deliveredVersion!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  declineReason!: string | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  submittedAt!: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  deliveredAt!: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  closedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class DataRequestListResponseDto {
  @ApiProperty({ type: [DataRequestListItemDto] })
  items!: DataRequestListItemDto[];

  @ApiProperty()
  total!: number;
}

export class DataRequestPermissionsDto {
  @ApiProperty()
  isRequester!: boolean;

  @ApiProperty()
  isTeam!: boolean;

  @ApiProperty()
  isManager!: boolean;

  @ApiProperty()
  canEditSpec!: boolean;

  @ApiProperty()
  canEditSql!: boolean;

  @ApiProperty()
  canPreview!: boolean;

  @ApiProperty()
  canSelfServe!: boolean;

  @ApiProperty({ type: [String] })
  allowedActions!: string[];
}

export class DataRequestDetailDto extends DataRequestListItemDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  spec!: Record<string, unknown>;

  @ApiProperty()
  specVersion!: number;

  @ApiProperty()
  draftSql!: string;

  @ApiProperty()
  sqlEdited!: boolean;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  lastCheck!: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  lastCheckSqlHash!: string | null;

  @ApiPropertyOptional({ type: DataRequestLiveDatasetDto, nullable: true })
  dataset!: DataRequestLiveDatasetDto | null;

  @ApiProperty({ type: [DataRequestDeliveryDto] })
  deliveries!: DataRequestDeliveryDto[];

  @ApiProperty({ type: [DataRequestCommentThreadDto] })
  threads!: DataRequestCommentThreadDto[];

  @ApiProperty({ type: DataRequestPermissionsDto })
  permissions!: DataRequestPermissionsDto;
}
