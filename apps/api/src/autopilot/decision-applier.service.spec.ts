import { Test, TestingModule } from '@nestjs/testing';
import { AiManagementMode } from '@prisma/client';
import { DecisionApplierService } from './decision-applier.service';
import { PrismaService } from '../prisma.service';
import { InquiriesService } from '../inquiries.service';
import { CasesService } from '../cases.service';
import { CaseThreadsService } from '../case-threads.service';
import { GraphService } from '../graph.service';
import { AgentAuditService } from './audit/agent-audit.service';
import { AgentSearchService } from './search/agent-search.service';
import { AI_ACTOR } from './autopilot.constants';
import type { InquiryDecision } from './autopilot.types';

describe('DecisionApplierService', () => {
  let service: DecisionApplierService;

  const mockPrisma = {
    inquiry: { findUnique: jest.fn() },
    case: { findUnique: jest.fn() },
    caseThread: { findFirst: jest.fn() },
  };
  const mockInquiries = { create: jest.fn(), update: jest.fn() };
  const mockCases = {
    create: jest.fn(),
    update: jest.fn(),
    addEvidence: jest.fn(),
    attachFindings: jest.fn(),
    linkInquiries: jest.fn(),
  };
  const mockThreads = {
    create: jest.fn(),
    update: jest.fn(),
    addEntry: jest.fn(),
  };
  const mockGraph = { createManualEdge: jest.fn() };
  const mockAudit = { recordDecision: jest.fn(), hasDecision: jest.fn() };
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
        { provide: AgentAuditService, useValue: mockAudit },
        { provide: AgentSearchService, useValue: mockSearch },
      ],
    }).compile();
    service = module.get(DecisionApplierService);
    jest.clearAllMocks();
    mockAudit.hasDecision.mockResolvedValue(false);
    mockAudit.recordDecision.mockResolvedValue(true);
  });

  const lastRecorded = () =>
    mockAudit.recordDecision.mock.calls[
      mockAudit.recordDecision.mock.calls.length - 1
    ]![1];

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

  describe('applyInquiryDecisions', () => {
    const flags = { inquiryEnabled: true, caseEnabled: true };

    it('records NO_ACTION with rationale and mutates nothing', async () => {
      const summary = await service.applyInquiryDecisions(
        'run-1',
        [
          {
            action: 'NO_ACTION',
            rationale: 'Nothing new worth monitoring in this scan.',
          },
        ],
        flags,
      );
      expect(summary.applied).toBe(0);
      expect(mockInquiries.create).not.toHaveBeenCalled();
      expect(lastRecorded()).toMatchObject({
        action: 'NO_ACTION',
        outcome: 'APPLIED',
      });
    });

    it('creates an inquiry with the AI actor', async () => {
      mockInquiries.create.mockResolvedValue({
        id: 'new-1',
        title: 'Leaked keys',
      });
      const summary = await service.applyInquiryDecisions(
        'run-1',
        [
          {
            action: 'CREATE_INQUIRY',
            rationale:
              'New AWS keys appeared and no inquiry covers secrets in this source.',
            inquiry: { title: 'Leaked keys', findingTypes: ['aws-access-key'] },
          },
        ],
        flags,
      );
      expect(summary.applied).toBe(1);
      expect(summary.createdInquiries).toEqual([
        { id: 'new-1', title: 'Leaked keys' },
      ]);
      expect(mockInquiries.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: AI_ACTOR, title: 'Leaked keys' }),
      );
    });

    it('skips updates on OBSERVE_ONLY inquiries and records the rationale', async () => {
      mockPrisma.inquiry.findUnique.mockResolvedValue({
        id: 'q1',
        aiMode: AiManagementMode.OBSERVE_ONLY,
        sourceIds: [],
        detectorTypes: [],
        customDetectorKeys: [],
        findingTypes: [],
        findingTypeRegex: [],
        findingValueRegex: [],
      });
      const summary = await service.applyInquiryDecisions(
        'run-1',
        [
          {
            action: 'UPDATE_INQUIRY',
            rationale: 'The new finding types belong to this inquiry topic.',
            inquiryId: 'q1',
            inquiry: { findingTypes: ['email'] },
          },
        ],
        flags,
      );
      expect(summary.skippedObserveOnly).toBe(1);
      expect(mockInquiries.update).not.toHaveBeenCalled();
      expect(lastRecorded()).toMatchObject({ outcome: 'SKIPPED_OBSERVE_ONLY' });
    });

    it('rejects invalid regexes as FAILED without mutating', async () => {
      const summary = await service.applyInquiryDecisions(
        'run-1',
        [
          {
            action: 'CREATE_INQUIRY',
            rationale: 'Looks like a coherent topic worth a dedicated monitor.',
            inquiry: { title: 'Broken', findingValueRegex: ['[unclosed'] },
          },
        ],
        flags,
      );
      expect(summary.failed).toBe(1);
      expect(mockInquiries.create).not.toHaveBeenCalled();
      expect(lastRecorded()).toMatchObject({ outcome: 'FAILED' });
    });

    it('rejects UPDATE_INQUIRY for unknown ids (hallucination guard)', async () => {
      mockPrisma.inquiry.findUnique.mockResolvedValue(null);
      const summary = await service.applyInquiryDecisions(
        'run-1',
        [
          {
            action: 'UPDATE_INQUIRY',
            rationale: 'Enrich the matcher with the new finding type values.',
            inquiryId: 'ghost',
          },
        ],
        flags,
      );
      expect(summary.failed).toBe(1);
      expect(mockInquiries.update).not.toHaveBeenCalled();
    });

    it('ENRICH merges matcher arrays instead of replacing them', async () => {
      mockPrisma.inquiry.findUnique.mockResolvedValue({
        id: 'q1',
        aiMode: AiManagementMode.INHERIT,
        sourceIds: ['s1'],
        detectorTypes: ['PII'],
        customDetectorKeys: [],
        findingTypes: ['email'],
        findingTypeRegex: [],
        findingValueRegex: [],
      });
      mockInquiries.update.mockResolvedValue({});
      await service.applyInquiryDecisions(
        'run-1',
        [
          {
            action: 'ENRICH_INQUIRY_MATCHERS',
            rationale: 'Phone numbers belong to the same PII exposure topic.',
            inquiryId: 'q1',
            inquiry: { findingTypes: ['phone'] },
          },
        ],
        flags,
      );
      expect(mockInquiries.update).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ findingTypes: ['email', 'phone'] }),
      );
    });

    it('skips decisions already recorded for this run (resume idempotency)', async () => {
      mockAudit.hasDecision.mockResolvedValue(true);
      const summary = await service.applyInquiryDecisions(
        'run-1',
        [
          {
            action: 'CREATE_INQUIRY',
            rationale: 'Already applied before the crash; must not run twice.',
            inquiry: { title: 'Dup' },
          },
        ],
        { inquiryEnabled: true, caseEnabled: true },
      );
      expect(summary.applied).toBe(0);
      expect(mockInquiries.create).not.toHaveBeenCalled();
      expect(mockAudit.recordDecision).not.toHaveBeenCalled();
    });

    it('SIGNAL_CASE_READY records a signal without mutating', async () => {
      mockSearch.existingIds.mockResolvedValue(new Set(['q1']));
      const summary = await service.applyInquiryDecisions(
        'run-1',
        [
          {
            action: 'SIGNAL_CASE_READY',
            rationale: 'Twelve correlated credential findings warrant a case.',
            inquiryId: 'q1',
          } satisfies InquiryDecision,
        ],
        flags,
      );
      expect(summary.caseReadyInquiryIds).toEqual(['q1']);
      expect(mockInquiries.update).not.toHaveBeenCalled();
    });
  });

  describe('applyCaseDecisions', () => {
    const flags = { inquiryEnabled: true, caseEnabled: true };

    it('skips UPDATE_CASE (and its operations) on OBSERVE_ONLY cases', async () => {
      mockPrisma.case.findUnique.mockResolvedValue({
        aiMode: AiManagementMode.OBSERVE_ONLY,
      });
      const summary = await service.applyCaseDecisions(
        'run-1',
        [
          {
            action: 'UPDATE_CASE',
            rationale: 'New matches strengthen the exfiltration hypothesis.',
            caseId: 'c1',
            operations: [
              {
                op: 'ADD_HYPOTHESIS',
                rationale: 'New correlated evidence suggests it.',
                title: 'H1',
              },
            ],
          },
        ],
        flags,
      );
      expect(summary.skippedObserveOnly).toBe(1);
      expect(mockThreads.create).not.toHaveBeenCalled();
      expect(mockCases.update).not.toHaveBeenCalled();
    });

    it('creates a case with operations, all attributed to the AI actor', async () => {
      mockCases.create.mockResolvedValue({
        id: 'c-new',
        title: 'Key leak investigation',
      });
      mockThreads.create.mockResolvedValue({ id: 't1' });
      mockSearch.existingIds.mockResolvedValue(new Set(['f1', 'q1']));
      mockCases.attachFindings.mockResolvedValue({ attached: 1 });
      mockCases.linkInquiries.mockResolvedValue({});

      const summary = await service.applyCaseDecisions(
        'run-1',
        [
          {
            action: 'CREATE_CASE',
            rationale:
              'No open case covers the correlated credential findings.',
            title: 'Key leak investigation',
            severity: 'HIGH',
            operations: [
              {
                op: 'ADD_HYPOTHESIS',
                rationale:
                  'The keys likely come from one CI pipeline misconfig.',
                title: 'Single origin',
              },
              {
                op: 'ATTACH_FINDINGS',
                rationale: 'These findings are the core evidence.',
                findingIds: ['f1'],
              },
              {
                op: 'LINK_INQUIRY',
                rationale: 'The inquiry drives this investigation.',
                inquiryIds: ['q1'],
              },
            ],
          },
        ],
        flags,
      );

      expect(summary.applied).toBe(4); // case + 3 ops
      expect(mockCases.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: AI_ACTOR }),
      );
      expect(mockThreads.create).toHaveBeenCalledWith(
        'c-new',
        expect.objectContaining({ createdBy: AI_ACTOR }),
      );
      expect(mockCases.attachFindings).toHaveBeenCalledWith('c-new', {
        findingIds: ['f1'],
        addedBy: AI_ACTOR,
      });
      expect(mockCases.linkInquiries).toHaveBeenCalledWith(
        'c-new',
        { inquiryIds: ['q1'] },
        AI_ACTOR,
      );
    });

    it('fails operations referencing unknown ids without throwing', async () => {
      mockPrisma.case.findUnique.mockResolvedValue({
        aiMode: AiManagementMode.MANAGED,
      });
      mockSearch.existingIds.mockResolvedValue(new Set());
      const summary = await service.applyCaseDecisions(
        'run-1',
        [
          {
            action: 'UPDATE_CASE',
            rationale: 'Attach the new evidence to the running investigation.',
            caseId: 'c1',
            operations: [
              {
                op: 'ADD_EVIDENCE',
                rationale: 'Asset holds two of the leaked keys.',
                assetId: 'ghost-asset',
              },
            ],
          },
        ],
        flags,
      );
      expect(summary.failed).toBe(1);
      expect(mockCases.addEvidence).not.toHaveBeenCalled();
    });
  });
});
