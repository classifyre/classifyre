import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InquiriesService } from './inquiries.service';
import { PrismaService } from './prisma.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';
import { AgentMemoryService } from './autopilot/memory/agent-memory.service';

describe('InquiriesService', () => {
  let service: InquiriesService;

  const mockPrisma = {
    inquiry: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    case: { findUnique: jest.fn() },
    source: { findMany: jest.fn() },
    customDetector: { findMany: jest.fn() },
    finding: { groupBy: jest.fn() },
  };
  const mockMatching = {
    rematchInquiry: jest.fn(),
    getLiveMatches: jest.fn(),
    preview: jest.fn(),
  };
  const mockAgentMemory = {
    recordEntityDeletion: jest.fn(),
    syncEntityMap: jest.fn(),
  };

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'q1',
    caseLinks: [],
    title: 'Exfil monitor',
    description: null,
    status: 'ACTIVE',
    createdBy: null,
    matchAllSources: true,
    sourceIds: [],
    detectorTypes: [],
    customDetectorKeys: [],
    findingTypes: ['ssn'],
    findingTypeRegex: [],
    findingValueRegex: [],
    matchCount: 3,
    newMatchCount: 0,
    matchesSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InquiriesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InquiryMatchingService, useValue: mockMatching },
        { provide: AgentMemoryService, useValue: mockAgentMemory },
      ],
    }).compile();
    service = module.get(InquiriesService);
    jest.clearAllMocks();
  });

  it('creates a query and seeds its matches', async () => {
    mockPrisma.inquiry.create.mockResolvedValue(row());
    mockPrisma.inquiry.findUnique.mockResolvedValue(row());
    mockMatching.rematchInquiry.mockResolvedValue({ landed: 3 });

    const result = await service.create({
      title: 'Exfil monitor',
      matchAllSources: true,
      findingTypes: ['ssn'],
    });

    expect(mockMatching.rematchInquiry).toHaveBeenCalledWith('q1');
    expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('inquiry', 'q1');
    expect(result.matchCount).toBe(3);
  });

  it('rejects an invalid regex matcher', async () => {
    await expect(
      service.create({ title: 'q', findingTypeRegex: ['('] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.inquiry.create).not.toHaveBeenCalled();
  });

  it('recomputes matches from scratch when matchers change on update', async () => {
    mockPrisma.inquiry.findUnique.mockResolvedValue(row());
    mockPrisma.inquiry.update.mockResolvedValue(row());
    mockMatching.rematchInquiry.mockResolvedValue({ landed: 2 });

    await service.update('q1', { findingTypes: ['email'] });

    expect(mockMatching.rematchInquiry).toHaveBeenCalledWith('q1');
    expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('inquiry', 'q1');
  });

  it('does NOT recompute when only metadata changes', async () => {
    mockPrisma.inquiry.findUnique.mockResolvedValue(row());
    mockPrisma.inquiry.update.mockResolvedValue(row());

    await service.update('q1', { title: 'Renamed' });

    expect(mockMatching.rematchInquiry).not.toHaveBeenCalled();
  });

  it('delegates preview to the matching engine with defaulted matchers', async () => {
    mockMatching.preview.mockResolvedValue({ total: 5, sample: [] });
    const result = await service.preview({ matchAllSources: true });
    expect(result.total).toBe(5);
    expect(mockMatching.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        matchAllSources: true,
        sourceIds: [],
        findingTypeRegex: [],
      }),
    );
  });

  it('reads matchCount and newMatchCount directly from the inquiry row', async () => {
    mockPrisma.inquiry.findUnique.mockResolvedValue(
      row({ matchCount: 7, newMatchCount: 2 }),
    );

    const result = await service.findOne('q1');
    expect(result?.matchCount).toBe(7);
    expect(result?.newMatchCount).toBe(2);
  });

  // Two inquiries sat at zero matches for hours while their detector was
  // producing findings the whole time. The cause is a shape difference that is
  // invisible from either DTO: a TAG detector's answer is in matchedContent
  // (`hoch (5/12): amtswegig gelöscht`), an LLM detector's answer IS the
  // finding type (`insolvenzgefahr_hoch`). A matcher written for one matches
  // nothing at all on the other, silently.
  describe('matchOptions answer dimension', () => {
    const arrange = (detectors: Array<Record<string, unknown>>) => {
      mockPrisma.source.findMany.mockResolvedValue([]);
      mockPrisma.customDetector.findMany.mockResolvedValue(detectors);
      mockPrisma.finding.groupBy
        // Corpus-wide finding types.
        .mockResolvedValueOnce([])
        // Per-custom-detector finding types.
        .mockResolvedValueOnce([
          {
            customDetectorKey: 'fb_shell_risk',
            findingType: 'tag:Shell-company risk',
            _count: { _all: 26 },
          },
          {
            customDetectorKey: 'fb_solvency_outlook',
            findingType: 'insolvenzgefahr_hoch',
            _count: { _all: 42 },
          },
          {
            customDetectorKey: 'fb_solvency_outlook',
            findingType: 'stabil',
            _count: { _all: 83 },
          },
        ]);
    };

    it('points a TAG detector at findingValueRegex and an LLM at findingTypes', async () => {
      arrange([
        {
          key: 'fb_shell_risk',
          name: 'Shell-company risk',
          pipelineSchema: { type: 'TAG' },
        },
        {
          key: 'fb_solvency_outlook',
          name: 'Solvency outlook',
          pipelineSchema: { type: 'LLM' },
        },
      ]);

      const options = await service.matchOptions();
      const tag = options.customDetectors.find(
        (d) => d.key === 'fb_shell_risk',
      )!;
      const llm = options.customDetectors.find(
        (d) => d.key === 'fb_solvency_outlook',
      )!;

      expect(tag.answerDimension).toBe('matchedContent');
      expect(tag.suggestedMatcher).toBe('findingValueRegex');
      expect(llm.answerDimension).toBe('findingType');
      expect(llm.suggestedMatcher).toBe('findingTypes');
    });

    it('lists the types a classifier actually emits, commonest first', async () => {
      arrange([
        {
          key: 'fb_solvency_outlook',
          name: 'Solvency outlook',
          pipelineSchema: { type: 'LLM' },
        },
      ]);

      const options = await service.matchOptions();
      const llm = options.customDetectors[0];

      // These are exactly the values that belong in `findingTypes`, which is
      // what turns the hint from advice into something copy-pasteable.
      expect(llm.findingTypes).toEqual(['stabil', 'insolvenzgefahr_hoch']);
      expect(llm.openFindings).toBe(125);
    });

    it('defaults an unrecognised engine to the value dimension', async () => {
      arrange([
        { key: 'mystery', name: 'Mystery', pipelineSchema: { type: 'FUTURE' } },
      ]);

      const options = await service.matchOptions();
      expect(options.customDetectors[0].answerDimension).toBe('matchedContent');
      expect(options.customDetectors[0].pipelineType).toBe('FUTURE');
    });
  });
});
