import {
  CaseKind,
  CaseStatus,
  DataRequestDeliveryMode,
  DataRequestState,
  Prisma,
  Severity,
} from '@prisma/client';
import {
  DataRequestSpecSchema,
  EMPTY_DATA_REQUEST_SPEC,
  type DataRequestSpec,
} from '@workspace/schemas/data-request';
import {
  allowedActionsFor,
  canEditSpec,
  canEditSql,
  type DataRequestRole,
} from './data-request-rules';
import type {
  DataRequestCommentThreadDto,
  DataRequestDeliveryDto,
  DataRequestDetailDto,
  DataRequestListItemDto,
  DataRequestLiveDatasetDto,
  LiveDatasetStatus,
} from './dto/data-request.dto';

export function parseSpecSafe(raw: unknown): DataRequestSpec {
  const parsed = DataRequestSpecSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_DATA_REQUEST_SPEC;
}

export interface DataRequestListRow {
  caseId: string;
  requesterRef: string;
  routeGroupId: string;
  audienceGroupId: string;
  assigneeRef: string | null;
  state: DataRequestState;
  datasetAssetId: string | null;
  deliveredVersion: number | null;
  declineReason: string | null;
  submittedAt: Date | null;
  deliveredAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  case: {
    kind: CaseKind;
    title: string;
    description: string | null;
    status: CaseStatus;
    severity: Severity;
  };
  dataset: { domain: string; name: string } | null;
}

export interface DataRequestDetailRow extends DataRequestListRow {
  spec: Prisma.JsonValue;
  specVersion: number;
  draftSql: string;
  sqlEdited: boolean;
  lastCheck: Prisma.JsonValue | null;
  lastCheckSqlHash: string | null;
  case: DataRequestListRow['case'] & {
    threads: Array<{
      id: string;
      title: string;
      createdBy: string | null;
      resolvedAt: Date | null;
      resolvedBy: string | null;
      createdAt: Date;
      updatedAt: Date;
      _count: { entries: number };
    }>;
  };
  deliveries: Array<{
    id: string;
    round: number;
    datasetAssetId: string;
    datasetVersion: number;
    sqlSnapshot: string;
    specSnapshot: Prisma.JsonValue;
    mode: DataRequestDeliveryMode;
    deliveredBy: string;
    note: string | null;
    createdAt: Date;
  }>;
  dataset: {
    assetId: string;
    domain: string;
    name: string;
    version: number;
    unavailableAt: Date | null;
    unavailableWhy: string | null;
    blocks: { id: string }[];
    asset: { governance: { status: string } | null };
  } | null;
}

export function mapDataRequestListItem(
  row: DataRequestListRow,
  names: Map<string, string>,
): DataRequestListItemDto {
  return {
    id: row.caseId,
    kind: row.case.kind,
    title: row.case.title,
    description: row.case.description,
    status: row.case.status,
    priority: row.case.severity,
    state: row.state,
    requester: {
      ref: row.requesterRef,
      name: names.get(row.requesterRef) ?? row.requesterRef,
    },
    routeGroup: {
      id: row.routeGroupId,
      name: names.get(`group:${row.routeGroupId}`) ?? row.routeGroupId,
    },
    audienceGroup: {
      id: row.audienceGroupId,
      name: names.get(`group:${row.audienceGroupId}`) ?? row.audienceGroupId,
    },
    assignee: row.assigneeRef
      ? {
          ref: row.assigneeRef,
          name: names.get(row.assigneeRef) ?? row.assigneeRef,
        }
      : null,
    datasetAssetId: row.datasetAssetId,
    datasetName: row.dataset
      ? `shared.${row.dataset.domain}.${row.dataset.name}`
      : null,
    deliveredVersion: row.deliveredVersion,
    declineReason: row.declineReason,
    submittedAt: row.submittedAt,
    deliveredAt: row.deliveredAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function computeLiveDataset(
  row: Pick<
    DataRequestDetailRow,
    'datasetAssetId' | 'deliveredVersion' | 'dataset'
  >,
): DataRequestLiveDatasetDto | null {
  if (!row.datasetAssetId && row.deliveredVersion === null) {
    return null;
  }
  if (!row.dataset) {
    return {
      assetId: null,
      sqlName: null,
      domain: null,
      name: null,
      currentVersion: null,
      deliveredVersion: row.deliveredVersion,
      status: 'removed',
      reason: 'The delivered shared dataset was removed.',
    };
  }
  const lifecycle = row.dataset.asset.governance?.status ?? 'DRAFT';
  let status: LiveDatasetStatus = 'ok';
  let reason: string | null = null;
  if (lifecycle === 'RETIRED') {
    status = 'retired';
    reason = 'This shared dataset has been retired.';
  } else if (row.dataset.blocks.length > 0) {
    status = 'blocked';
    reason = 'An owner of an underlying table blocked this dataset.';
  } else if (row.dataset.unavailableAt) {
    status = 'unavailable';
    reason =
      row.dataset.unavailableWhy ??
      'The owning group lost access to one of the underlying tables.';
  }
  return {
    assetId: row.dataset.assetId,
    sqlName: `shared.${row.dataset.domain}.${row.dataset.name}`,
    domain: row.dataset.domain,
    name: row.dataset.name,
    currentVersion: row.dataset.version,
    deliveredVersion: row.deliveredVersion,
    status,
    reason,
  };
}

export function mapDataRequestDetail(
  row: DataRequestDetailRow,
  context: {
    names: Map<string, string>;
    datasetNameById: Map<string, string>;
    roles: readonly DataRequestRole[];
    isRequester: boolean;
    isTeam: boolean;
    isManager: boolean;
    canSelfServe: boolean;
  },
): DataRequestDetailDto {
  const base = mapDataRequestListItem(row, context.names);
  const deliveries: DataRequestDeliveryDto[] = row.deliveries.map((d) => ({
    id: d.id,
    round: d.round,
    datasetAssetId: d.datasetAssetId,
    datasetName: context.datasetNameById.get(d.datasetAssetId) ?? null,
    datasetVersion: d.datasetVersion,
    sqlSnapshot: d.sqlSnapshot,
    specSnapshot: (d.specSnapshot ?? EMPTY_DATA_REQUEST_SPEC) as Record<
      string,
      unknown
    >,
    mode: d.mode,
    deliveredBy: {
      ref: d.deliveredBy,
      name: context.names.get(d.deliveredBy) ?? d.deliveredBy,
    },
    note: d.note,
    createdAt: d.createdAt,
  }));

  const threads: DataRequestCommentThreadDto[] = row.case.threads.map((t) => ({
    id: t.id,
    title: t.title,
    createdBy: t.createdBy,
    resolvedAt: t.resolvedAt,
    resolvedBy: t.resolvedBy,
    entryCount: t._count.entries,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));

  return {
    ...base,
    spec: parseSpecSafe(row.spec) as unknown as Record<string, unknown>,
    specVersion: row.specVersion,
    draftSql: row.draftSql,
    sqlEdited: row.sqlEdited,
    lastCheck: (row.lastCheck as Record<string, unknown> | null) ?? null,
    lastCheckSqlHash: row.lastCheckSqlHash,
    dataset: computeLiveDataset(row),
    deliveries,
    threads,
    permissions: {
      isRequester: context.isRequester,
      isTeam: context.isTeam,
      isManager: context.isManager,
      canEditSpec: canEditSpec(row.state, context.roles),
      canEditSql: canEditSql(row.state, context.roles),
      canPreview: context.isTeam || context.isManager,
      canSelfServe: context.canSelfServe,
      allowedActions: allowedActionsFor(row.state, context.roles),
    },
  };
}
