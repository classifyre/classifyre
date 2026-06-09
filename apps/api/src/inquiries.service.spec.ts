import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InquiriesService } from './inquiries.service';
import { PrismaService } from './prisma.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';

describe('InquiriesService', () => {
  let service: InquiriesService;

  const mockPrisma = {
    question: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    inquiryMatch: { findMany: jest.fn(), deleteMany: jest.fn() },
    case: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const mockMatching = { rematchQuestion: jest.fn(), preview: jest.fn() };

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'q1',
    caseId: null,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { matches: 3 },
    ...over,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InquiriesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InquiryMatchingService, useValue: mockMatching },
      ],
    }).compile();
    service = module.get(InquiriesService);
    jest.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([]);
  });

  it('creates a query and seeds its matches', async () => {
    mockPrisma.question.create.mockResolvedValue(row());
    mockPrisma.question.findUnique.mockResolvedValue(row());
    mockMatching.rematchQuestion.mockResolvedValue({ landed: 3 });

    const result = await service.create({ title: 'Exfil monitor', matchAllSources: true, findingTypes: ['ssn'] });

    expect(mockMatching.rematchQuestion).toHaveBeenCalledWith('q1');
    expect(result.matchCount).toBe(3);
  });

  it('rejects an invalid regex matcher', async () => {
    await expect(service.create({ title: 'q', findingTypeRegex: ['('] })).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.question.create).not.toHaveBeenCalled();
  });

  it('recomputes matches from scratch when matchers change on update', async () => {
    mockPrisma.question.findUnique.mockResolvedValue(row());
    mockPrisma.question.update.mockResolvedValue(row());
    mockPrisma.inquiryMatch.deleteMany.mockResolvedValue({ count: 3 });
    mockMatching.rematchQuestion.mockResolvedValue({ landed: 2 });

    await service.update('q1', { findingTypes: ['email'] });

    expect(mockPrisma.inquiryMatch.deleteMany).toHaveBeenCalledWith({ where: { inquiryId: 'q1' } });
    expect(mockMatching.rematchQuestion).toHaveBeenCalledWith('q1');
  });

  it('does NOT recompute when only metadata changes', async () => {
    mockPrisma.question.findUnique.mockResolvedValue(row());
    mockPrisma.question.update.mockResolvedValue(row());

    await service.update('q1', { title: 'Renamed' });

    expect(mockPrisma.inquiryMatch.deleteMany).not.toHaveBeenCalled();
    expect(mockMatching.rematchQuestion).not.toHaveBeenCalled();
  });

  it('delegates preview to the matching engine with defaulted matchers', async () => {
    mockMatching.preview.mockResolvedValue({ total: 5, sample: [] });
    const result = await service.preview({ matchAllSources: true });
    expect(result.total).toBe(5);
    expect(mockMatching.preview).toHaveBeenCalledWith(
      expect.objectContaining({ matchAllSources: true, sourceIds: [], findingTypeRegex: [] }),
    );
  });

  it('computes newMatchCount from the seen-watermark query', async () => {
    mockPrisma.question.findUnique.mockResolvedValue(row({ _count: { matches: 3 } }));
    mockPrisma.$queryRaw.mockResolvedValue([{ question_id: 'q1', cnt: 2n }]);

    const result = await service.findOne('q1');
    expect(result?.matchCount).toBe(3);
    expect(result?.newMatchCount).toBe(2);
  });
});
