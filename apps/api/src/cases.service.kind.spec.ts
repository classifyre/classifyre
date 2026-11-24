import { BadRequestException } from '@nestjs/common';
import {
  AiManagementMode,
  CaseKind,
  CaseStatus,
  DataRequestState,
  Severity,
} from '@prisma/client';
import { CasesService } from './cases.service';
import { CaseLeadsService } from './case-leads.service';
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
