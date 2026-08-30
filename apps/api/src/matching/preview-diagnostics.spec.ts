import { Test, TestingModule } from '@nestjs/testing';
import { InquiryMatchingService } from './inquiry-matching.service';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import type { InquiryMatchers } from './inquiry-matcher';

/**
 * A preview that returns nothing has to say which dimension emptied it.
 *
 * Zero matches is ambiguous in the worst possible way: an inquiry with a wrong
 * matcher and an inquiry with nothing to match are indistinguishable, and both
 * look like a finished, working question. Two real inquiries sat at zero for
 * hours while their detector produced findings the entire time — the matcher
 * was pointed at `matchedContent` for a detector that answers in `findingType`.
 */
describe('preview diagnostics', () => {
  let service: InquiryMatchingService;

  const mockPrisma = {
    inquiry: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    finding: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
  };

  const matchers = (over: Partial<InquiryMatchers> = {}): InquiryMatchers => ({
    matchAllSources: true,
    sourceIds: [],
    detectorTypes: [],
    customDetectorKeys: [],
    findingTypes: [],
    findingTypeRegex: [],
    findingValueRegex: [],
    ...over,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InquiryMatchingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PgBossService, useValue: {} },
      ],
    }).compile();
    service = module.get(InquiryMatchingService);
    jest.clearAllMocks();
    mockPrisma.finding.groupBy.mockResolvedValue([]);
  });

  it('says nothing at all when the preview has matches', async () => {
    mockPrisma.finding.count.mockResolvedValue(12);
    mockPrisma.finding.findMany.mockResolvedValue([]);

    const result = await service.preview(matchers({ findingTypes: ['email'] }));

    expect(result.total).toBe(12);
    expect(result.diagnostics).toEqual([]);
  });

  it('distinguishes an empty corpus from a broken matcher', async () => {
    // count() is called for the preview total AND for the corpus probe.
    mockPrisma.finding.count.mockResolvedValue(0);
    mockPrisma.finding.findMany.mockResolvedValue([]);

    const result = await service.preview(matchers({ findingTypes: ['email'] }));

    expect(result.total).toBe(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].dimension).toBe('corpus');
    expect(result.diagnostics[0].message).toContain('no open findings at all');
  });

  it('names the finding-type dimension when dropping it unlocks findings', async () => {
    mockPrisma.finding.count
      .mockResolvedValueOnce(0) // the preview itself
      .mockResolvedValueOnce(4231) // corpus probe
      .mockResolvedValueOnce(88); // leave-one-out: without findingTypes
    mockPrisma.finding.findMany.mockResolvedValue([]);

    const result = await service.preview(matchers({ findingTypes: ['nope'] }));

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].dimension).toBe('findingTypes');
    expect(result.diagnostics[0].survivingWithout).toBe(88);
  });

  it('names the value regex AND the detector that answers in findingType', async () => {
    // The §5.10 trap, exactly: a TAG-shaped matcher pointed at an LLM detector.
    // With a value regex configured, previewRows scans rows instead of
    // counting, so the first count() a value-regex preview makes is the corpus
    // probe inside the diagnostic itself.
    mockPrisma.finding.count
      .mockResolvedValueOnce(4231) // corpus
      .mockResolvedValueOnce(125); // without detectors
    // The detector dimension survives on its own, so it is reported too; then
    // the value regex is scanned in memory.
    mockPrisma.finding.findMany.mockResolvedValue([
      {
        id: 'f1',
        sourceId: 's1',
        detectorType: 'CUSTOM',
        customDetectorKey: 'fb_solvency_outlook',
        findingType: 'insolvenzgefahr_hoch',
        matchedContent: 'Eigenkapital -194.756,31 EUR',
      },
    ]);
    mockPrisma.finding.groupBy.mockResolvedValue([
      {
        customDetectorKey: 'fb_solvency_outlook',
        findingType: 'insolvenzgefahr_hoch',
      },
      { customDetectorKey: 'fb_solvency_outlook', findingType: 'stabil' },
    ]);

    const result = await service.preview(
      matchers({
        customDetectorKeys: ['fb_solvency_outlook'],
        findingValueRegex: ['insolvenzgefahr_hoch'],
      }),
    );

    const valueDiag = result.diagnostics.find(
      (d) => d.dimension === 'findingValueRegex',
    );
    expect(valueDiag).toBeDefined();
    expect(valueDiag!.message).toContain('fb_solvency_outlook');
    expect(valueDiag!.message).toContain('finding TYPE');
    expect(valueDiag!.message).toContain('use findingTypes');
  });

  it('says the question is wired consistently when no single dimension is at fault', async () => {
    mockPrisma.finding.count
      .mockResolvedValueOnce(0) // preview
      .mockResolvedValueOnce(4231) // corpus
      .mockResolvedValueOnce(0) // without sources
      .mockResolvedValueOnce(0); // without detectors
    mockPrisma.finding.findMany.mockResolvedValue([]);

    const result = await service.preview(
      matchers({
        matchAllSources: false,
        sourceIds: ['s1'],
        detectorTypes: ['PII'],
      }),
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('no matches yet');
  });
});
