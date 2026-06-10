import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InquiriesService } from './inquiries.service';
import { PrismaService } from './prisma.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';

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
  const mockMatching = { rematchInquiry: jest.fn(), getLiveMatches: jest.fn(), preview: jest.fn() };

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
      ],
    }).compile();
    service = module.get(InquiriesService);
    jest.clearAllMocks();
  });

  it('creates a query and seeds its matches', async () => {
    mockPrisma.inquiry.create.mockResolvedValue(row());
    mockPrisma.inquiry.findUnique.mockResolvedValue(row());
    mockMatching.rematchInquiry.mockResolvedValue({ landed: 3 });

    const result = await service.create({ title: 'Exfil monitor', matchAllSources: true, findingTypes: ['ssn'] });

    expect(mockMatching.rematchInquiry).toHaveBeenCalledWith('q1');
    expect(result.matchCount).toBe(3);
  });

  it('rejects an invalid regex matcher', async () => {
    await expect(service.create({ title: 'q', findingTypeRegex: ['('] })).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.inquiry.create).not.toHaveBeenCalled();
  });

  it('recomputes matches from scratch when matchers change on update', async () => {
    mockPrisma.inquiry.findUnique.mockResolvedValue(row());
    mockPrisma.inquiry.update.mockResolvedValue(row());
    mockMatching.rematchInquiry.mockResolvedValue({ landed: 2 });

    await service.update('q1', { findingTypes: ['email'] });

    expect(mockMatching.rematchInquiry).toHaveBeenCalledWith('q1');
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
      expect.objectContaining({ matchAllSources: true, sourceIds: [], findingTypeRegex: [] }),
    );
  });

  it('reads matchCount and newMatchCount directly from the inquiry row', async () => {
    mockPrisma.inquiry.findUnique.mockResolvedValue(row({ matchCount: 7, newMatchCount: 2 }));

    const result = await service.findOne('q1');
    expect(result?.matchCount).toBe(7);
    expect(result?.newMatchCount).toBe(2);
  });
});
