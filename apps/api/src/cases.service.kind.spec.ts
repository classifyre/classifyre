import { BadRequestException } from '@nestjs/common';
import {
  AiManagementMode,
  CaseKind,
  CaseStatus,
  DataRequestState,
  Severity,
} from '@prisma/client';
import { CasesService } from './cases.service';
import { CaseworkSummaryService } from './casework-summary.service';
import { CaseLeadsService } from './case-leads.service';
import { CaseLeadsScheduler } from './cases/case-leads.scheduler';
import { CaseBoardGateway } from './websocket/case-board.gateway';
import { DecisionApplierService } from './autopilot/decision-applier.service';
import { AgentSearchService } from './autopilot/search/agent-search.service';
import { CLS_PERSON } from './identity/iam-access-policy';

describe('CaseKind.DATA_REQUEST guards and investigation scoping', () => {
  describe('CasesService guards', () => {
    function makeCasesService(opts: { viewerRef?: string } = {}) {
      const prisma = {
        case: {
          findUnique: jest.fn(),
          findMany: jest.fn(() => Promise.resolve([])),
          count: jest.fn(() => Promise.resolve(0)),
          update: jest.fn(),
        },
        caseFinding: { groupBy: jest.fn(() => Promise.resolve([])) },
        caseInquiry: { findMany: jest.fn(() => Promise.resolve([])) },
        caseBoardThumbnail: { findMany: jest.fn(() => Promise.resolve([])) },
      };
      const cls = opts.viewerRef
        ? {
            isActive: () => true,
            get: (key: string) =>
              key === CLS_PERSON
                ? { actorRef: opts.viewerRef, groupIds: [] }
                : undefined,
          }
        : undefined;
      const service = new CasesService(
        prisma as never,
        { inferEdgesForAsset: jest.fn(), caseGraph: jest.fn() } as never,
        { getMatchingFindingIds: jest.fn() } as never,
        { record: jest.fn(), recordEdit: jest.fn() } as never,
        { tryRecord: jest.fn() } as never,
        { syncEntityMap: jest.fn(), recordEntityDeletion: jest.fn() } as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        cls as never,
      );
      return { service, prisma };
    }

    it('rejects investigation-only actions on DATA_REQUEST cases with 400 BadRequestException', async () => {
      const { service, prisma } = makeCasesService();
      prisma.case.findUnique.mockResolvedValue({
        id: 'dr-1',
        kind: CaseKind.DATA_REQUEST,
      });

      await expect(
        service.addEvidence('dr-1', {
          entityType: 'asset',
          entityId: 'a-1',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.linkInquiries('dr-1', { inquiryIds: ['inq-1'] }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.close('dr-1', { conclusion: 'done' }),
      ).rejects.toThrow(BadRequestException);

      await expect(service.reopen('dr-1', { note: 'again' })).rejects.toThrow(
        BadRequestException,
      );

      await expect(
        service.pullFromInquiry('dr-1', { inquiryId: 'inq-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects status changes via update() on DATA_REQUEST cases with 400 BadRequestException', async () => {
      const { service, prisma } = makeCasesService();
      prisma.case.findUnique.mockResolvedValue({
        kind: CaseKind.DATA_REQUEST,
        title: 'Revenue dataset',
        description: null,
        status: CaseStatus.OPEN,
        severity: Severity.MEDIUM,
        assignee: null,
        conclusion: null,
        aiMode: AiManagementMode.INHERIT,
        removeGoneFindings: false,
        removeResolvedFindings: false,
        removeGoneAssets: false,
      });

      await expect(
        service.update('dr-1', { status: CaseStatus.CLOSED }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.case.update).not.toHaveBeenCalled();
    });

    it('passes kind filter and draft visibility rules in list()', async () => {
      const { service, prisma } = makeCasesService({
        viewerRef: 'user:alice',
      });

      await service.list({
        kind: [CaseKind.DATA_REQUEST],
      });

      expect(prisma.case.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            kind: { in: [CaseKind.DATA_REQUEST] },
            AND: expect.arrayContaining([
              {
                OR: [
                  { kind: CaseKind.INVESTIGATION },
                  { dataRequest: { state: { not: DataRequestState.DRAFT } } },
                  { dataRequest: { requesterRef: 'user:alice' } },
                ],
              },
            ]),
          }),
        }),
      );
    });

    it('hides another user DRAFT data request in findOne() and allows its requester', async () => {
      const draftRow = {
        id: 'dr-draft',
        kind: CaseKind.DATA_REQUEST,
        title: 'Secret draft',
        description: null,
        status: CaseStatus.OPEN,
        severity: Severity.MEDIUM,
        assignee: null,
        conclusion: null,
        createdBy: 'user:alice',
        createdAt: new Date(),
        updatedAt: new Date(),
        aiMode: AiManagementMode.INHERIT,
        removeGoneFindings: false,
        removeResolvedFindings: false,
        removeGoneAssets: false,
        _count: { evidence: 0, threads: 0, inquiryLinks: 0, findings: 0 },
        dataRequest: {
          state: DataRequestState.DRAFT,
          requesterRef: 'user:alice',
          routeGroupId: 'grp-data',
          audienceGroupId: 'grp-finance',
          deliveredVersion: null,
          spec: { tables: [], joins: [], pins: [] },
          updatedAt: new Date(),
          dataset: null,
        },
        evidence: [],
        inquiryLinks: [],
        findingFilters: [],
        hypothesisRules: [],
      };

      const bob = makeCasesService({ viewerRef: 'user:bob' });
      bob.prisma.case.findUnique.mockResolvedValue(draftRow);
      await expect(bob.service.findOne('dr-draft')).resolves.toBeNull();

      const alice = makeCasesService({ viewerRef: 'user:alice' });
      alice.prisma.case.findUnique.mockResolvedValue(draftRow);
      await expect(alice.service.findOne('dr-draft')).resolves.toMatchObject({
        id: 'dr-draft',
        kind: CaseKind.DATA_REQUEST,
      });
    });
  });

  describe('CaseworkSummaryService draft visibility', () => {
    it('excludes other users DRAFT data requests from counts and recent list', async () => {
      const prisma = {
        case: {
          groupBy: jest.fn(() => Promise.resolve([])),
          findMany: jest.fn(() => Promise.resolve([])),
        },
        inquiry: {
          groupBy: jest.fn(() => Promise.resolve([])),
          aggregate: jest.fn(() => Promise.resolve({ _sum: { newMatchCount: 0 } })),
          findMany: jest.fn(() => Promise.resolve([])),
        },
        caseLead: { count: jest.fn(() => Promise.resolve(0)) },
      };
      const cls = {
        isActive: () => true,
        get: (key: string) =>
          key === CLS_PERSON
            ? { actorRef: 'user:bob', groupIds: ['grp-data'] }
            : undefined,
      };
      const summary = new CaseworkSummaryService(prisma as never, cls as never);

      await summary.getSummary();

      const expectedWhere = {
        OR: [
          { kind: CaseKind.INVESTIGATION },
          { dataRequest: { state: { not: DataRequestState.DRAFT } } },
          { dataRequest: { requesterRef: 'user:bob' } },
        ],
      };
      expect(prisma.case.groupBy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.case.groupBy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.case.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });
  });

  describe('CaseLeadsScheduler investigation scoping', () => {
    it('does not enqueue lead refresh jobs for DATA_REQUEST cases', async () => {
      const send = jest.fn();
      const pgBoss = { getBossAsync: jest.fn(() => Promise.resolve({ send })) };
      const prisma = {
        case: {
          findFirst: jest.fn(() => Promise.resolve(null)),
        },
      };
      const scheduler = new CaseLeadsScheduler(
        pgBoss as never,
        undefined,
        prisma as never,
      );

      await scheduler.request('dr-1', 'updated');
      await scheduler.requestOnRead('dr-1');

      expect(prisma.case.findFirst).toHaveBeenCalledWith({
        where: { id: 'dr-1', kind: CaseKind.INVESTIGATION },
        select: { id: true },
      });
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('CaseBoardGateway per-case room authorization', () => {
    const CASE_ID = '11111111-2222-3333-4444-555555555555';

    function makeGateway(opts: {
      hasCaseView: boolean;
      person: { actorRef: string; groupIds: string[] } | null;
      caseRow: {
        kind: CaseKind;
        dataRequest: {
          state: DataRequestState;
          requesterRef: string;
          routeGroupId: string;
          audienceGroupId: string;
        } | null;
      } | null;
    }) {
      const cls = {
        run: (fn: () => Promise<unknown>) => fn(),
        set: jest.fn(),
        get: jest.fn(),
      };
      const namespaces = {
        resolve: jest.fn(() =>
          Promise.resolve({ namespaceId: 'ns-1', schemaName: 'ns_demo' }),
        ),
      };
      const socketAccess = {
        canJoin: jest.fn((_c: unknown, _ns: string, cap: string) =>
          Promise.resolve(cap === 'case.view' ? opts.hasCaseView : true),
        ),
        person: jest.fn(() => Promise.resolve(opts.person)),
      };
      const prisma = {
        case: {
          findUnique: jest.fn(() => Promise.resolve(opts.caseRow)),
        },
      };
      const gateway = new CaseBoardGateway(
        cls as never,
        namespaces as never,
        socketAccess as never,
        prisma as never,
      );
      gateway.server = { to: jest.fn(() => ({ emit: jest.fn() })) } as never;
      const client = {
        id: 'sock-1',
        data: {
          classifyrePrincipal: {
            actor: { displayName: 'Test User', ref: opts.person?.actorRef },
          },
        } as Record<string, unknown>,
        handshake: { auth: { namespaceSlug: 'demo' } },
        join: jest.fn(() => Promise.resolve()),
        leave: jest.fn(() => Promise.resolve()),
      };
      return { gateway, client };
    }

    it('forbids workspace-only users from subscribing to INVESTIGATION boards', async () => {
      const { gateway, client } = makeGateway({
        hasCaseView: false,
        person: { actorRef: 'user:alice', groupIds: ['grp-finance'] },
        caseRow: { kind: CaseKind.INVESTIGATION, dataRequest: null },
      });

      const res = await gateway.subscribe(client as never, { caseId: CASE_ID });
      expect(res).toEqual({ success: false, message: 'Forbidden' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('restricts DRAFT data-request rooms to the requester only', async () => {
      const other = makeGateway({
        hasCaseView: true,
        person: { actorRef: 'user:bob', groupIds: ['grp-data'] },
        caseRow: {
          kind: CaseKind.DATA_REQUEST,
          dataRequest: {
            state: DataRequestState.DRAFT,
            requesterRef: 'user:alice',
            routeGroupId: 'grp-data',
            audienceGroupId: 'grp-finance',
          },
        },
      });
      await expect(
        other.gateway.subscribe(other.client as never, { caseId: CASE_ID }),
      ).resolves.toEqual({ success: false, message: 'Forbidden' });

      const requester = makeGateway({
        hasCaseView: false,
        person: { actorRef: 'user:alice', groupIds: ['grp-finance'] },
        caseRow: {
          kind: CaseKind.DATA_REQUEST,
          dataRequest: {
            state: DataRequestState.DRAFT,
            requesterRef: 'user:alice',
            routeGroupId: 'grp-data',
            audienceGroupId: 'grp-finance',
          },
        },
      });
      await expect(
        requester.gateway.subscribe(requester.client as never, {
          caseId: CASE_ID,
        }),
      ).resolves.toEqual({ success: true });
      expect(requester.client.join).toHaveBeenCalledWith(
        `ns_demo:case-board:${CASE_ID}`,
      );
    });

    it('allows routed data team members without case.view to subscribe to SUBMITTED data requests', async () => {
      const team = makeGateway({
        hasCaseView: false,
        person: { actorRef: 'user:bob', groupIds: ['grp-data'] },
        caseRow: {
          kind: CaseKind.DATA_REQUEST,
          dataRequest: {
            state: DataRequestState.SUBMITTED,
            requesterRef: 'user:alice',
            routeGroupId: 'grp-data',
            audienceGroupId: 'grp-finance',
          },
        },
      });
      await expect(
        team.gateway.subscribe(team.client as never, { caseId: CASE_ID }),
      ).resolves.toEqual({ success: true });
    });
  });

  describe('CaseLeadsService.generate', () => {
    it('returns an empty result without generating leads for DATA_REQUEST cases', async () => {
      const prisma = {
        case: {
          findUnique: jest.fn(() =>
            Promise.resolve({
              id: 'dr-1',
              status: CaseStatus.OPEN,
              kind: CaseKind.DATA_REQUEST,
            }),
          ),
        },
        caseEvidence: { findMany: jest.fn() },
        caseLead: { findMany: jest.fn() },
      };
      const leadsService = new CaseLeadsService(
        prisma as never,
        { record: jest.fn() } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const res = await leadsService.generate('dr-1');

      expect(res).toEqual({
        proposed: 0,
        considered: 0,
        settled: 0,
        byOrigin: {},
      });
      expect(prisma.caseEvidence.findMany).not.toHaveBeenCalled();
      expect(prisma.caseLead.findMany).not.toHaveBeenCalled();
    });
  });

  describe('DecisionApplierService.caseGate', () => {
    it('returns OBSERVE_ONLY for DATA_REQUEST cases even when autopilot is enabled and aiMode is MANAGED', async () => {
      const prisma = {
        case: {
          findUnique: jest.fn(() =>
            Promise.resolve({
              aiMode: AiManagementMode.MANAGED,
              kind: CaseKind.DATA_REQUEST,
            }),
          ),
        },
      };
      const applier = new DecisionApplierService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(applier.caseGate('dr-1', true)).resolves.toBe(
        AiManagementMode.OBSERVE_ONLY,
      );
    });
  });

  describe('AgentSearchService investigation scoping', () => {
    it('includes kind: INVESTIGATION in listOpenCases, listRecentlyClosedCases, openHypotheses, and existingIds("case")', async () => {
      const prisma = {
        case: {
          findMany: jest.fn((_args?: { where?: Record<string, unknown> }) =>
            Promise.resolve([]),
          ),
          count: jest.fn(() => Promise.resolve(0)),
        },
      };
      const search = new AgentSearchService(prisma as never, {} as never);

      await search.listOpenCases();
      expect(prisma.case.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ kind: CaseKind.INVESTIGATION }),
      });
      for (const call of prisma.case.findMany.mock.calls) {
        expect(call[0]?.where).toMatchObject({ kind: CaseKind.INVESTIGATION });
      }

      prisma.case.findMany.mockClear();
      await search.listRecentlyClosedCases();
      expect(prisma.case.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ kind: CaseKind.INVESTIGATION }),
        }),
      );

      prisma.case.findMany.mockClear();
      await search.openHypotheses();
      expect(prisma.case.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ kind: CaseKind.INVESTIGATION }),
        }),
      );

      prisma.case.findMany.mockClear();
      await search.existingIds('case', ['c-1']);
      expect(prisma.case.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ kind: CaseKind.INVESTIGATION }),
        }),
      );
    });
  });
});
