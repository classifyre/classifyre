import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  CaseActivityType,
  CaseKind,
  CaseStatus,
  CaseThreadKind,
  DataRequestDeliveryMode,
  DataRequestState,
  Severity,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { CLS_PERSON, type ClsPerson } from '../identity/iam-access-policy';
import { DataRequestsService } from './data-requests.service';

const BASE_SPEC = {
  tables: [
    {
      id: 't1',
      assetId: 'asset-orders',
      sqlName: 'lake.sales.orders',
      alias: 'o',
      x: 10,
      y: 20,
      keep: ['id', 'total'],
      filters: [],
    },
  ],
  joins: [],
  pins: [],
};

const GENERATED_SQL = 'SELECT\n  o.id,\n  o.total\nFROM lake.sales.orders o';

const CATALOG_TABLE = {
  assetId: 'asset-orders',
  sourceId: 'src-lake',
  name: 'orders',
  schema: 'sales',
  table: 'orders',
  sqlName: 'lake.sales.orders',
  columns: [
    { name: 'id', type: 'INTEGER' },
    { name: 'total', type: 'NUMERIC' },
  ],
  queryable: true,
  canQuery: true,
  location: { kind: 'table' },
  masks: [],
  hiddenColumns: 0,
};

interface RowState {
  caseId: string;
  requesterRef: string;
  routeGroupId: string;
  audienceGroupId: string;
  assigneeRef: string | null;
  state: DataRequestState;
  spec: unknown;
  specVersion: number;
  draftSql: string;
  sqlEdited: boolean;
  lastCheck: unknown;
  lastCheckSqlHash: string | null;
  datasetAssetId: string | null;
  deliveredVersion: number | null;
  declineReason: string | null;
  submittedAt: Date | null;
  deliveredAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  case: {
    id: string;
    kind: CaseKind;
    title: string;
    description: string | null;
    status: CaseStatus;
    severity: Severity;
    assignee: string | null;
    threads: Array<{
      id: string;
      title: string;
      createdBy: string | null;
      resolvedAt: Date | null;
      resolvedBy: string | null;
      _count: { entries: number };
      createdAt: Date;
      updatedAt: Date;
    }>;
  };
  deliveries: Array<{
    id: string;
    round: number;
    datasetAssetId: string;
    datasetVersion: number;
    sqlSnapshot: string;
    specSnapshot: unknown;
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

function makeRow(over: Partial<RowState> = {}): RowState {
  const now = new Date('2026-11-24T12:00:00Z');
  return {
    caseId: 'case-1',
    requesterRef: 'user:alice',
    routeGroupId: 'grp-data',
    audienceGroupId: 'grp-finance',
    assigneeRef: null,
    state: DataRequestState.DRAFT,
    spec: BASE_SPEC,
    specVersion: 1,
    draftSql: GENERATED_SQL,
    sqlEdited: false,
    lastCheck: null,
    lastCheckSqlHash: null,
    datasetAssetId: null,
    deliveredVersion: null,
    declineReason: null,
    submittedAt: null,
    deliveredAt: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    case: {
      id: 'case-1',
      kind: CaseKind.DATA_REQUEST,
      title: 'Monthly orders export',
      description: 'Need orders by month',
      status: CaseStatus.OPEN,
      severity: Severity.MEDIUM,
      assignee: null,
      threads: [],
    },
    deliveries: [],
    dataset: null,
    ...over,
  };
}

function setup(opts: {
  person?: ClsPerson;
  capabilities?: string[];
  eligibleGroups?: Array<{ id: string; name: string; path?: string }>;
  row?: RowState | null;
  sharedDataset?: {
    assetId: string;
    domain: string;
    name: string;
    version: number;
    sql: string;
    createdBy: string;
  } | null;
  audienceCanQuery?: boolean;
  groupNames?: Record<string, string>;
} = {}) {
  const person: ClsPerson = opts.person ?? {
    actorRef: 'user:alice',
    groupIds: ['grp-finance'],
  };
  let storedRow: RowState | null = opts.row === undefined ? makeRow() : opts.row;
  const createdDeliveries: Record<string, unknown>[] = [];
  const createdCases: Record<string, unknown>[] = [];
  const createdRequests: Record<string, unknown>[] = [];

  const tx: Record<string, any> = {
    case: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        createdCases.push(data);
        const created = {
          id: 'case-new',
          ...data,
          threads: [],
        };
        return Promise.resolve(created);
      }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (storedRow) {
          Object.assign(storedRow.case, data);
        }
        return Promise.resolve(storedRow?.case ?? {});
      }),
    },
    dataRequest: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        createdRequests.push(data);
        storedRow = makeRow({
          caseId: String(data.caseId),
          requesterRef: String(data.requesterRef),
          routeGroupId: String(data.routeGroupId),
          audienceGroupId: String(data.audienceGroupId),
          state: data.state as DataRequestState,
          spec: data.spec,
          specVersion: Number(data.specVersion),
          draftSql: String(data.draftSql),
          sqlEdited: Boolean(data.sqlEdited),
          case: {
            id: String(data.caseId),
            kind: CaseKind.DATA_REQUEST,
            title: String(createdCases[0]?.title ?? 'Untitled'),
            description: (createdCases[0]?.description as string | null) ?? null,
            status: (createdCases[0]?.status as CaseStatus) ?? CaseStatus.OPEN,
            severity: (createdCases[0]?.severity as Severity) ?? Severity.MEDIUM,
            assignee: null,
            threads: [],
          },
        });
        return Promise.resolve(storedRow);
      }),
      update: jest.fn(({ data }: { data: Record<string, any> }) => {
        if (storedRow) {
          const next = { ...data };
          if (next.specVersion && typeof next.specVersion === 'object' && 'increment' in next.specVersion) {
            next.specVersion = storedRow.specVersion + next.specVersion.increment;
          }
          Object.assign(storedRow, next);
        }
        return Promise.resolve(storedRow);
      }),
      updateMany: jest.fn(
        ({ where, data }: { where: { caseId: string; specVersion?: number }; data: Record<string, unknown> }) => {
          if (
            !storedRow ||
            storedRow.caseId !== where.caseId ||
            (where.specVersion !== undefined && storedRow.specVersion !== where.specVersion)
          ) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(storedRow, data);
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    dataRequestDelivery: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const entry = {
          id: `del-${createdDeliveries.length + 1}`,
          createdAt: new Date('2026-11-24T12:10:00Z'),
          ...data,
        };
        createdDeliveries.push(entry);
        storedRow?.deliveries.unshift(entry as RowState['deliveries'][number]);
        return Promise.resolve(entry);
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) => fn(tx)),
    case: tx.case,
    dataRequest: {
      ...tx.dataRequest,
      findUnique: jest.fn(({ where }: { where: { caseId: string } }) =>
        Promise.resolve(
          storedRow && storedRow.caseId === where.caseId ? storedRow : null,
        ),
      ),
      findMany: jest.fn(() => Promise.resolve(storedRow ? [storedRow] : [])),
    },
    dataRequestDelivery: {
      ...tx.dataRequestDelivery,
      count: jest.fn(() => Promise.resolve(storedRow?.deliveries.length ?? 0)),
    },
    sharedDataset: {
      findUnique: jest.fn(({ where }: { where: { assetId: string } }) => {
        if (!opts.sharedDataset || opts.sharedDataset.assetId !== where.assetId) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          ...opts.sharedDataset,
          asset: { governance: { status: 'ACTIVE' } },
          blocks: [],
        });
      }),
      findMany: jest.fn(() =>
        Promise.resolve(
          opts.sharedDataset
            ? [
                {
                  assetId: opts.sharedDataset.assetId,
                  domain: opts.sharedDataset.domain,
                  name: opts.sharedDataset.name,
                },
              ]
            : [],
        ),
      ),
    },
    governanceRole: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
  };

  const cls = {
    isActive: () => true,
    get: (key: string) => (key === CLS_PERSON ? person : undefined),
  };

  const actors = {
    current: () => ({ id: person.actorRef, ref: person.actorRef }),
    workspaceId: () => 'ws-1',
  };

  const groupNames: Record<string, string> = {
    'user:alice': 'Alice',
    'user:bob': 'Bob',
    'group:grp-data': 'Data Team',
    'group:grp-finance': 'Finance',
    ...(opts.groupNames ?? {}),
  };
  const directory = {
    resolve: jest.fn((refs: string[]) =>
      Promise.resolve(
        refs.map((ref) => ({
          ref,
          displayName: groupNames[ref] ?? ref,
          path: groupNames[ref] ?? ref,
        })),
      ),
    ),
  };

  const audit = { record: jest.fn(() => Promise.resolve()) };

  const catalog = {
    tables: jest.fn(() =>
      Promise.resolve({
        sources: [{ id: 'src-lake', name: 'Lake', sqlName: 'lake' }],
        tables: [CATALOG_TABLE],
      }),
    ),
  };

  const resolver = {
    principalForGroup: jest.fn((groupId: string) =>
      Promise.resolve({
        ownerRef: null,
        person: { actorRef: `group:${groupId}`, groupIds: [groupId] },
        capabilities: new Set(),
        resourceGrants: () => ({ sourceIds: [], assetIds: [] }),
      }),
    ),
    catalogForGroup: jest.fn((groupId: string) => {
      if (groupId === 'grp-finance') {
        const ds = opts.sharedDataset;
        return Promise.resolve({
          sources: ds
            ? [
                {
                  id: 'src-shared',
                  sqlName: 'shared',
                  tables: [
                    {
                      assetId: ds.assetId,
                      sqlName: `shared.${ds.domain}.${ds.name}`,
                      canQuery: opts.audienceCanQuery ?? true,
                      location: { kind: 'dataset' },
                      masks: [],
                      hiddenColumns: 0,
                    },
                  ],
                },
              ]
            : [],
        });
      }
      return Promise.resolve({
        sources: [
          {
            id: 'src-lake',
            sqlName: 'lake',
            tables: [CATALOG_TABLE],
          },
        ],
      });
    }),
  };

  const sharedDatasets = {
    describeForGroup: jest.fn(() =>
      Promise.resolve({
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'total', type: 'NUMERIC' },
        ],
        inputs: [],
        problems: [],
      }),
    ),
  };

  const activity = { record: jest.fn(() => Promise.resolve()) };

  const threads = {
    create: jest.fn(() =>
      Promise.resolve({
        id: 'thread-1',
        title: 'Changes requested',
        createdBy: person.actorRef,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    getEntries: jest.fn(),
    addEntry: jest.fn(),
    setResolved: jest.fn(),
  };

  const notifier = {
    submitted: jest.fn(() => Promise.resolve()),
    assigned: jest.fn(() => Promise.resolve()),
    delivered: jest.fn(() => Promise.resolve()),
    changesRequested: jest.fn(() => Promise.resolve()),
    declined: jest.fn(() => Promise.resolve()),
    withdrawn: jest.fn(() => Promise.resolve()),
  };

  const caps = new Set(opts.capabilities ?? ['workspace.view']);
  const policy = {
    check: jest.fn((_actor: unknown, cap: string) =>
      Promise.resolve({ allow: caps.has(cap) }),
    ),
  };

  const identity = {
    groupsWithCapabilityIn: jest.fn(() =>
      Promise.resolve(
        opts.eligibleGroups ?? [
          { id: 'grp-data', name: 'Data Team', path: 'Data Team' },
        ],
      ),
    ),
  };

  const boardEvents = { emitChanged: jest.fn() };

  const service = new DataRequestsService(
    prisma as never,
    cls as never,
    actors as never,
    directory as never,
    audit as never,
    catalog as never,
    resolver as never,
    sharedDatasets as never,
    activity as never,
    threads as never,
    notifier as never,
    policy as never,
    identity as never,
    boardEvents as never,
  );

  return {
    service,
    prisma,
    tx,
    resolver,
    sharedDatasets,
    activity,
    threads,
    notifier,
    boardEvents,
    createdCases,
    createdRequests,
    createdDeliveries,
    getRow: () => storedRow,
  };
}

describe('DataRequestsService', () => {
  describe('create', () => {
    it('rejects a route group that does not hold dataset.publish', async () => {
      const { service, createdCases } = setup({
        eligibleGroups: [{ id: 'grp-data', name: 'Data Team' }],
      });

      await expect(
        service.create({
          title: 'Revenue dataset',
          routeGroupId: 'grp-no-publish',
          audienceGroupId: 'grp-finance',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(createdCases).toHaveLength(0);
    });

    it('creates Case(DATA_REQUEST, OPEN) and DataRequest(DRAFT) in one transaction', async () => {
      const { service, createdCases, createdRequests, activity } = setup({
        row: null,
      });

      const detail = await service.create({
        title: 'Revenue dataset',
        description: 'Monthly revenue roll-up',
        priority: Severity.HIGH,
        routeGroupId: 'grp-data',
        audienceGroupId: 'grp-finance',
        spec: BASE_SPEC,
      });

      expect(createdCases).toHaveLength(1);
      expect(createdCases[0]).toMatchObject({
        kind: CaseKind.DATA_REQUEST,
        title: 'Revenue dataset',
        status: CaseStatus.OPEN,
        severity: Severity.HIGH,
        createdBy: 'user:alice',
      });
      expect(createdRequests).toHaveLength(1);
      expect(createdRequests[0]).toMatchObject({
        caseId: 'case-new',
        requesterRef: 'user:alice',
        routeGroupId: 'grp-data',
        audienceGroupId: 'grp-finance',
        state: DataRequestState.DRAFT,
        specVersion: 1,
        draftSql: GENERATED_SQL,
        sqlEdited: false,
      });
      expect(activity.record).toHaveBeenCalledWith(
        'case-new',
        CaseActivityType.CASE_CREATED,
        expect.objectContaining({ kind: CaseKind.DATA_REQUEST }),
        'user:alice',
        expect.anything(),
      );
      expect(detail.id).toBe('case-new');
      expect(detail.state).toBe(DataRequestState.DRAFT);
    });
  });

  describe('draft visibility', () => {
    it('forbids non-requester from reading a DRAFT request, even if on route team or with case.view', async () => {
      const { service } = setup({
        person: { actorRef: 'user:bob', groupIds: ['grp-data', 'grp-finance'] },
        capabilities: ['workspace.view', 'case.view', 'case.manage'],
        row: makeRow({ state: DataRequestState.DRAFT, requesterRef: 'user:alice' }),
      });

      await expect(service.get('case-1')).rejects.toThrow(ForbiddenException);
    });

    it('allows requester to read their DRAFT request and team to read once SUBMITTED', async () => {
      const reqCtx = setup({
        person: { actorRef: 'user:alice', groupIds: ['grp-finance'] },
        row: makeRow({ state: DataRequestState.DRAFT }),
      });
      await expect(reqCtx.service.get('case-1')).resolves.toMatchObject({
        id: 'case-1',
        state: DataRequestState.DRAFT,
      });

      const teamCtx = setup({
        person: { actorRef: 'user:bob', groupIds: ['grp-data'] },
        row: makeRow({ state: DataRequestState.SUBMITTED }),
      });
      await expect(teamCtx.service.get('case-1')).resolves.toMatchObject({
        id: 'case-1',
        state: DataRequestState.SUBMITTED,
      });
    });
  });

  describe('updateSpec', () => {
    it('throws 409 ConflictException on stale baseVersion', async () => {
      const { service } = setup({
        row: makeRow({ specVersion: 3 }),
      });

      await expect(
        service.updateSpec('case-1', { spec: BASE_SPEC, baseVersion: 2 }),
      ).rejects.toThrow(ConflictException);
    });

    it('regenerates SQL when sqlEdited is false', async () => {
      const { service, getRow, boardEvents } = setup({
        row: makeRow({ specVersion: 1, draftSql: 'OLD', sqlEdited: false }),
      });

      const detail = await service.updateSpec('case-1', {
        spec: BASE_SPEC,
        baseVersion: 1,
      });

      expect(getRow()!.specVersion).toBe(2);
      expect(getRow()!.draftSql).toBe(GENERATED_SQL);
      expect(detail.draftSql).toBe(GENERATED_SQL);
      expect(boardEvents.emitChanged).toHaveBeenCalledWith(
        'case-1',
        expect.objectContaining({ version: 2, summary: 'spec updated' }),
      );
    });

    it('preserves hand-edited SQL when sqlEdited is true', async () => {
      const customSql = 'SELECT id, total * 2 AS doubled FROM lake.sales.orders';
      const { service, getRow } = setup({
        person: { actorRef: 'user:bob', groupIds: ['grp-data'] },
        row: makeRow({
          state: DataRequestState.IN_PROGRESS,
          specVersion: 2,
          draftSql: customSql,
          sqlEdited: true,
        }),
      });

      const detail = await service.updateSpec('case-1', {
        spec: BASE_SPEC,
        baseVersion: 2,
      });

      expect(getRow()!.specVersion).toBe(3);
      expect(getRow()!.draftSql).toBe(customSql);
      expect(detail.draftSql).toBe(customSql);
    });
  });

  describe('updateSql', () => {
    it('forbids requester-only from editing SQL directly', async () => {
      const { service } = setup({
        person: { actorRef: 'user:alice', groupIds: ['grp-finance'] },
        row: makeRow({ state: DataRequestState.DRAFT }),
      });

      await expect(
        service.updateSql('case-1', {
          sql: 'SELECT 1',
          baseVersion: 1,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('marks sqlEdited when team edits SQL and clears sqlEdited on regenerate: true', async () => {
      const { service, getRow } = setup({
        person: { actorRef: 'user:bob', groupIds: ['grp-data'] },
        row: makeRow({ state: DataRequestState.SUBMITTED, specVersion: 1 }),
      });

      const edited = await service.updateSql('case-1', {
        sql: 'SELECT id FROM lake.sales.orders',
        baseVersion: 1,
      });
      expect(edited.sqlEdited).toBe(true);
      expect(edited.draftSql).toBe('SELECT id FROM lake.sales.orders');
      expect(getRow()!.specVersion).toBe(2);

      const regen = await service.updateSql('case-1', {
        regenerate: true,
        baseVersion: 2,
      });
      expect(regen.sqlEdited).toBe(false);
      expect(regen.draftSql).toBe(GENERATED_SQL);
      expect(getRow()!.specVersion).toBe(3);
    });
  });

  describe('submit', () => {
    it('transitions DRAFT to SUBMITTED and notifies routeGroupId', async () => {
      const { service, getRow, notifier, activity } = setup({
        person: { actorRef: 'user:alice', groupIds: ['grp-finance'] },
        row: makeRow({ state: DataRequestState.DRAFT }),
      });

      const detail = await service.submit('case-1');

      expect(detail.state).toBe(DataRequestState.SUBMITTED);
      expect(getRow()!.submittedAt).toBeInstanceOf(Date);
      expect(getRow()!.case.status).toBe(CaseStatus.OPEN);
      expect(activity.record).toHaveBeenCalledWith(
        'case-1',
        CaseActivityType.REQUEST_SUBMITTED,
        { routeGroupId: 'grp-data' },
        'user:alice',
        expect.anything(),
      );
      expect(notifier.submitted).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: 'case-1',
          routeGroupId: 'grp-data',
          requesterName: 'Alice',
        }),
      );
    });
  });

  describe('claim', () => {
    it('sets assignee, transitions to IN_PROGRESS, and updates Case status to IN_PROGRESS', async () => {
      const { service, getRow, notifier, activity } = setup({
        person: { actorRef: 'user:bob', groupIds: ['grp-data'] },
        row: makeRow({ state: DataRequestState.SUBMITTED }),
      });

      const detail = await service.claim('case-1', {});

      expect(detail.state).toBe(DataRequestState.IN_PROGRESS);
      expect(getRow()!.assigneeRef).toBe('user:bob');
      expect(getRow()!.case.status).toBe(CaseStatus.IN_PROGRESS);
      expect(getRow()!.case.assignee).toBe('user:bob');
      expect(activity.record).toHaveBeenCalledWith(
        'case-1',
        CaseActivityType.REQUEST_CLAIMED,
        { assigneeRef: 'user:bob' },
        'user:bob',
        expect.anything(),
      );
      expect(notifier.assigned).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: 'case-1',
          to: { personRefs: ['user:alice'] },
        }),
      );
    });
  });

  describe('deliver', () => {
    const sharedDataset = {
      assetId: 'ds-1',
      domain: 'finance',
      name: 'monthly_orders',
      version: 1,
      sql: GENERATED_SQL,
      createdBy: 'user:bob',
    };

    it('refuses delivery if the audience group cannot query the dataset', async () => {
      const { service, createdDeliveries, notifier } = setup({
        person: { actorRef: 'user:bob', groupIds: ['grp-data'] },
        row: makeRow({ state: DataRequestState.IN_PROGRESS }),
        sharedDataset,
        audienceCanQuery: false,
      });

      await expect(
        service.deliver('case-1', { datasetAssetId: 'ds-1' }),
      ).rejects.toThrow(new BadRequestException('Share it with Finance first.'));
      expect(createdDeliveries).toHaveLength(0);
      expect(notifier.delivered).not.toHaveBeenCalled();
    });

    it('creates a delivery row, closes the case, and notifies the requester', async () => {
      const { service, getRow, createdDeliveries, notifier } = setup({
        person: { actorRef: 'user:bob', groupIds: ['grp-data'] },
        row: makeRow({ state: DataRequestState.IN_PROGRESS }),
        sharedDataset,
        audienceCanQuery: true,
      });

      const detail = await service.deliver('case-1', {
        datasetAssetId: 'ds-1',
        note: 'Published v1',
      });

      expect(detail.state).toBe(DataRequestState.DELIVERED);
      expect(getRow()!.case.status).toBe(CaseStatus.CLOSED);
      expect(getRow()!.datasetAssetId).toBe('ds-1');
      expect(getRow()!.deliveredVersion).toBe(1);
      expect(createdDeliveries).toHaveLength(1);
      expect(createdDeliveries[0]).toMatchObject({
        caseId: 'case-1',
        round: 1,
        datasetAssetId: 'ds-1',
        datasetVersion: 1,
        mode: DataRequestDeliveryMode.PUBLISHED,
        deliveredBy: 'user:bob',
        note: 'Published v1',
      });
      expect(notifier.delivered).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: 'case-1',
          requesterRef: 'user:alice',
          datasetName: 'shared.finance.monthly_orders',
          version: 1,
        }),
      );
    });

    it('allows requester self-serve only when requester created the dataset', async () => {
      // Requester did NOT create the dataset -> forbidden
      const denied = setup({
        person: { actorRef: 'user:alice', groupIds: ['grp-finance'] },
        row: makeRow({ state: DataRequestState.SUBMITTED }),
        sharedDataset: { ...sharedDataset, createdBy: 'user:bob' },
        audienceCanQuery: true,
      });
      await expect(
        denied.service.deliver('case-1', { datasetAssetId: 'ds-1' }),
      ).rejects.toThrow(ForbiddenException);

      // Requester created the dataset -> succeeds with SELF_SERVE mode (even from DRAFT)
      const allowed = setup({
        person: { actorRef: 'user:alice', groupIds: ['grp-finance'] },
        row: makeRow({ state: DataRequestState.DRAFT }),
        sharedDataset: { ...sharedDataset, createdBy: 'user:alice' },
        audienceCanQuery: true,
      });
      const detail = await allowed.service.deliver('case-1', {
        datasetAssetId: 'ds-1',
      });
      expect(detail.state).toBe(DataRequestState.DELIVERED);
      expect(allowed.createdDeliveries[0]).toMatchObject({
        mode: DataRequestDeliveryMode.SELF_SERVE,
        deliveredBy: 'user:alice',
      });
      // Self-serve does not self-notify the requester
      expect(allowed.notifier.delivered).not.toHaveBeenCalled();
    });
  });

  describe('requestChanges', () => {
    it('creates a DISCUSSION thread, transitions to CHANGES_REQUESTED, and notifies route group', async () => {
      const { service, getRow, threads, notifier } = setup({
        person: { actorRef: 'user:alice', groupIds: ['grp-finance'] },
        row: makeRow({ state: DataRequestState.DELIVERED }),
      });

      const detail = await service.requestChanges('case-1', {
        reason: 'Please add currency column',
      });

      expect(detail.state).toBe(DataRequestState.CHANGES_REQUESTED);
      expect(getRow()!.case.status).toBe(CaseStatus.IN_PROGRESS);
      expect(threads.create).toHaveBeenCalledWith(
        'case-1',
        expect.objectContaining({
          kind: CaseThreadKind.DISCUSSION,
          statement: 'Please add currency column',
          createdBy: 'user:alice',
        }),
        expect.anything(),
      );
      expect(notifier.changesRequested).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: 'case-1',
          routeGroupId: 'grp-data',
          reason: 'Please add currency column',
        }),
      );
    });
  });

  describe('decline', () => {
    it('requires a non-empty reason', async () => {
      const { service, notifier } = setup({
        person: { actorRef: 'user:bob', groupIds: ['grp-data'] },
        row: makeRow({ state: DataRequestState.SUBMITTED }),
      });

      await expect(
        service.decline('case-1', { reason: '   ' }),
      ).rejects.toThrow(BadRequestException);
      expect(notifier.declined).not.toHaveBeenCalled();
    });

    it('declines the request, closes the case, and notifies the requester', async () => {
      const { service, getRow, notifier } = setup({
        person: { actorRef: 'user:bob', groupIds: ['grp-data'] },
        row: makeRow({ state: DataRequestState.SUBMITTED }),
      });

      const detail = await service.decline('case-1', {
        reason: 'PII export requires DPO sign-off',
      });

      expect(detail.state).toBe(DataRequestState.DECLINED);
      expect(getRow()!.declineReason).toBe('PII export requires DPO sign-off');
      expect(getRow()!.case.status).toBe(CaseStatus.CLOSED);
      expect(notifier.declined).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: 'case-1',
          requesterRef: 'user:alice',
          reason: 'PII export requires DPO sign-off',
        }),
      );
    });
  });

  describe('describe', () => {
    it('always runs describeForGroup using row.routeGroupId and caches the result by SQL hash', async () => {
      const expectedHash = createHash('sha256')
        .update(`grp-data\n${GENERATED_SQL}`)
        .digest('hex')
        .slice(0, 32);

      // Caller is requester (in grp-finance, NOT grp-data) — must still describe as row.routeGroupId ('grp-data')
      const ctx = setup({
        person: { actorRef: 'user:alice', groupIds: ['grp-finance'] },
        row: makeRow({
          state: DataRequestState.DRAFT,
          routeGroupId: 'grp-data',
          audienceGroupId: 'grp-finance',
          lastCheck: null,
          lastCheckSqlHash: null,
        }),
      });

      const first = await ctx.service.describe('case-1');
      expect(first.cached).toBe(false);
      expect(first.sqlHash).toBe(expectedHash);
      expect(first.error).toBeNull();
      expect(ctx.sharedDatasets.describeForGroup).toHaveBeenCalledTimes(1);
      expect(ctx.sharedDatasets.describeForGroup).toHaveBeenCalledWith(
        GENERATED_SQL,
        'grp-data',
      );
      expect(ctx.getRow()!.lastCheckSqlHash).toBe(expectedHash);

      // Second call hits cache without calling describeForGroup again
      const second = await ctx.service.describe('case-1');
      expect(second.cached).toBe(true);
      expect(second.sqlHash).toBe(expectedHash);
      expect(ctx.sharedDatasets.describeForGroup).toHaveBeenCalledTimes(1);
    });
  });
});
