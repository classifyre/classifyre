import { Test, TestingModule } from '@nestjs/testing';
import { AiManagementMode } from '@prisma/client';
import { DecisionApplierService } from './decision-applier.service';
import { PrismaService } from '../prisma.service';
import { InquiriesService } from '../inquiries.service';
import { CasesService } from '../cases.service';
import { CaseThreadsService } from '../case-threads.service';
import { GraphService } from '../graph.service';
import { AgentSearchService } from './search/agent-search.service';
import { AI_ACTOR } from './autopilot.constants';

describe('DecisionApplierService', () => {
  let service: DecisionApplierService;

  const mockPrisma = {
    inquiry: { findUnique: jest.fn() },
    case: { findUnique: jest.fn() },
    caseThread: { findFirst: jest.fn() },
  };
  const mockInquiries = {
    create: jest.fn(),
    update: jest.fn(),
    rematch: jest.fn(),
  };
  const mockCases = {
    create: jest.fn(),
    update: jest.fn(),
    addEvidence: jest.fn(),
    attachFindings: jest.fn(),
    linkInquiries: jest.fn(),
    close: jest.fn(),
    reopen: jest.fn(),
  };
  const mockThreads = {
    create: jest.fn(),
    update: jest.fn(),
    addEntry: jest.fn(),
  };
  const mockGraph = { createManualEdge: jest.fn(), deleteEdge: jest.fn() };
  const mockSearch = { existingIds: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecisionApplierService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InquiriesService, useValue: mockInquiries },
        { provide: CasesService, useValue: mockCases },
        { provide: CaseThreadsService, useValue: mockThreads },
        { provide: GraphService, useValue: mockGraph },
        { provide: AgentSearchService, useValue: mockSearch },
      ],
    }).compile();
    service = module.get(DecisionApplierService);
    jest.clearAllMocks();
  });

  describe('effectiveMode', () => {
    it('resolves INHERIT from the instance flag', () => {
      expect(service.effectiveMode(AiManagementMode.INHERIT, true)).toBe(
        AiManagementMode.MANAGED,
      );
      expect(service.effectiveMode(AiManagementMode.INHERIT, false)).toBe(
        AiManagementMode.OBSERVE_ONLY,
      );
    });

    it('entity override beats the instance flag', () => {
      expect(service.effectiveMode(AiManagementMode.OBSERVE_ONLY, true)).toBe(
        AiManagementMode.OBSERVE_ONLY,
      );
      expect(service.effectiveMode(AiManagementMode.MANAGED, false)).toBe(
        AiManagementMode.MANAGED,
      );
    });
  });

  describe('gates', () => {
    it('inquiryGate returns the entity mode when present', async () => {
      mockPrisma.inquiry.findUnique.mockResolvedValue({
        aiMode: AiManagementMode.OBSERVE_ONLY,
      });
      expect(await service.inquiryGate('q1', true)).toBe(
        AiManagementMode.OBSERVE_ONLY,
      );
    });

    it('caseGate returns MANAGED for an unknown id (handler will fail)', async () => {
      mockPrisma.case.findUnique.mockResolvedValue(null);
      expect(await service.caseGate('ghost', false)).toBe(
        AiManagementMode.MANAGED,
      );
    });
  });

  describe('createInquiryCore', () => {
    it('creates with the AI actor', async () => {
      mockInquiries.create.mockResolvedValue({
        id: 'q1',
        title: 'Leaked keys',
      });
      const res = await service.createInquiryCore({
        title: 'Leaked keys',
        findingTypes: ['aws-access-key'],
      });
      expect(res).toEqual({ id: 'q1', title: 'Leaked keys' });
      expect(mockInquiries.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: AI_ACTOR, title: 'Leaked keys' }),
      );
    });

    it('throws on invalid regex without mutating', async () => {
      await expect(
        service.createInquiryCore({
          title: 'Broken',
          findingValueRegex: ['[unclosed'],
        }),
      ).rejects.toThrow(/invalid regex/);
      expect(mockInquiries.create).not.toHaveBeenCalled();
    });

    it('throws when title is missing', async () => {
      await expect(service.createInquiryCore({})).rejects.toThrow(/title/);
    });
  });

  describe('updateInquiryCore', () => {
    it('throws for unknown ids (hallucination guard)', async () => {
      mockPrisma.inquiry.findUnique.mockResolvedValue(null);
      await expect(
        service.updateInquiryCore('ghost', {}, false),
      ).rejects.toThrow(/Unknown inquiryId/);
      expect(mockInquiries.update).not.toHaveBeenCalled();
    });

    it('enrich merges matcher arrays instead of replacing them', async () => {
      mockPrisma.inquiry.findUnique.mockResolvedValue({
        id: 'q1',
        sourceIds: ['s1'],
        detectorTypes: ['PII'],
        customDetectorKeys: [],
        findingTypes: ['email'],
        findingTypeRegex: [],
        findingValueRegex: [],
      });
      await service.updateInquiryCore('q1', { findingTypes: ['phone'] }, true);
      expect(mockInquiries.update).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ findingTypes: ['email', 'phone'] }),
      );
    });
  });

  describe('case primitives', () => {
    it('createCaseCore attributes the case to the AI actor', async () => {
      mockCases.create.mockResolvedValue({ id: 'c1', title: 'Key leak' });
      const res = await service.createCaseCore({
        title: 'Key leak',
        severity: 'HIGH',
      });
      expect(res).toEqual({ id: 'c1', title: 'Key leak' });
      expect(mockCases.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: AI_ACTOR }),
      );
    });

    it('applyCaseOperationCore throws on unknown asset for ADD_EVIDENCE', async () => {
      mockSearch.existingIds.mockResolvedValue(new Set());
      await expect(
        service.applyCaseOperationCore('c1', {
          op: 'ADD_EVIDENCE',
          rationale: '',
          assetId: 'ghost',
        }),
      ).rejects.toThrow(/Unknown assetId/);
      expect(mockCases.addEvidence).not.toHaveBeenCalled();
    });

    it('applyCaseOperationCore attaches valid findings', async () => {
      mockSearch.existingIds.mockResolvedValue(new Set(['f1']));
      mockCases.attachFindings.mockResolvedValue({ attached: 1 });
      await service.applyCaseOperationCore('c1', {
        op: 'ATTACH_FINDINGS',
        rationale: '',
        findingIds: ['f1'],
      });
      expect(mockCases.attachFindings).toHaveBeenCalledWith('c1', {
        findingIds: ['f1'],
        addedBy: AI_ACTOR,
      });
    });
  });

  describe('close / reopen / inquiry status', () => {
    it('closeCaseCore requires a non-empty conclusion', async () => {
      mockSearch.existingIds.mockResolvedValue(new Set(['c1']));
      await expect(service.closeCaseCore('c1', '   ')).rejects.toThrow(
        /conclusion is required/,
      );
      expect(mockCases.close).not.toHaveBeenCalled();
    });

    it('closeCaseCore closes via CasesService as the AI actor', async () => {
      mockSearch.existingIds.mockResolvedValue(new Set(['c1']));
      mockCases.close.mockResolvedValue({ archivedInquiries: 2 });
      const res = await service.closeCaseCore('c1', 'False positives.');
      expect(res).toEqual({ archivedInquiries: 2 });
      expect(mockCases.close).toHaveBeenCalledWith('c1', {
        conclusion: 'False positives.',
        closedBy: AI_ACTOR,
      });
    });

    it('reopenCaseCore reopens via CasesService as the AI actor', async () => {
      mockSearch.existingIds.mockResolvedValue(new Set(['c1']));
      mockCases.reopen.mockResolvedValue({ reactivatedInquiries: 1 });
      const res = await service.reopenCaseCore('c1', 'It recurred.');
      expect(res).toEqual({ reactivatedInquiries: 1 });
      expect(mockCases.reopen).toHaveBeenCalledWith('c1', {
        note: 'It recurred.',
        reopenedBy: AI_ACTOR,
      });
    });

    it('setInquiryStatusCore archives without rematching', async () => {
      mockSearch.existingIds.mockResolvedValue(new Set(['q1']));
      await service.setInquiryStatusCore('q1', 'ARCHIVED');
      expect(mockInquiries.update).toHaveBeenCalledWith('q1', {
        status: 'ARCHIVED',
      });
      expect(mockInquiries.rematch).not.toHaveBeenCalled();
    });

    it('setInquiryStatusCore reactivates and rematches', async () => {
      mockSearch.existingIds.mockResolvedValue(new Set(['q1']));
      await service.setInquiryStatusCore('q1', 'ACTIVE');
      expect(mockInquiries.update).toHaveBeenCalledWith('q1', {
        status: 'ACTIVE',
      });
      expect(mockInquiries.rematch).toHaveBeenCalledWith('q1');
    });

    it('setInquiryStatusCore throws for an unknown inquiry', async () => {
      mockSearch.existingIds.mockResolvedValue(new Set());
      await expect(
        service.setInquiryStatusCore('ghost', 'ARCHIVED'),
      ).rejects.toThrow(/Unknown inquiryId/);
      expect(mockInquiries.update).not.toHaveBeenCalled();
    });
  });
});
