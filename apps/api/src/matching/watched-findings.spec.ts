import { DetectorType } from '@prisma/client';
import { InquiryMatchingService } from './inquiry-matching.service';
import type { PrismaService } from '../prisma.service';
import type { PgBossService } from '../scheduler/pg-boss.service';

/**
 * "Is anyone relying on this finding?" — the primitive behind two rules that
 * both turn on that question: the ingest path must not auto-resolve watched
 * evidence when its detector leaves the config, and the autopilot must be told
 * what a config change would cost before it makes one.
 */
describe('InquiryMatchingService.watchersForFindings', () => {
  const prisma = {
    finding: { findMany: jest.fn() },
    inquiry: { findMany: jest.fn() },
  };
  const service = new InquiryMatchingService(
    prisma as unknown as PrismaService,
    {} as unknown as PgBossService,
  );

  const emailFinding = {
    id: 'f1',
    sourceId: 's1',
    detectorType: DetectorType.PII,
    findingType: 'email',
    customDetectorKey: null,
    matchedContent: 'a@b.c',
  };
  const phoneFinding = { ...emailFinding, id: 'f2', findingType: 'us_phone' };

  const inquiry = (over: Record<string, unknown> = {}) => ({
    id: 'q1',
    matchAllSources: true,
    sourceIds: [],
    detectorTypes: [],
    customDetectorKeys: [],
    findingTypes: [],
    findingTypeRegex: [],
    findingValueRegex: [],
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.inquiry.findMany.mockResolvedValue([]);
  });

  it('maps each watched finding to the inquiries watching it', async () => {
    prisma.inquiry.findMany.mockResolvedValue([
      inquiry({ id: 'q1', findingTypes: ['email'] }),
      inquiry({ id: 'q2', findingTypes: ['email', 'us_phone'] }),
    ]);

    const watched = await service.watchersForFindings([
      emailFinding,
      phoneFinding,
    ]);

    expect(watched.get('f1')).toEqual(['q1', 'q2']);
    expect(watched.get('f2')).toEqual(['q2']);
  });

  it('omits findings no active inquiry matches', async () => {
    prisma.inquiry.findMany.mockResolvedValue([
      inquiry({ findingTypes: ['ssn'] }),
    ]);

    const watched = await service.watchersForFindings([emailFinding]);

    expect(watched.size).toBe(0);
  });

  it('reads active inquiries once, not once per finding', async () => {
    prisma.inquiry.findMany.mockResolvedValue([inquiry()]);
    const many = Array.from({ length: 500 }, (_, i) => ({
      ...emailFinding,
      id: `f${i}`,
    }));

    await service.watchersForFindings(many);

    expect(prisma.inquiry.findMany).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there are no active inquiries', async () => {
    const watched = await service.watchersForFindings([emailFinding]);

    expect(watched.size).toBe(0);
  });

  it('never queries for an empty input', async () => {
    expect((await service.watchersForFindings([])).size).toBe(0);
    expect((await service.watchedBy([])).size).toBe(0);
    expect(prisma.inquiry.findMany).not.toHaveBeenCalled();
    expect(prisma.finding.findMany).not.toHaveBeenCalled();
  });

  it('watchedBy loads the rows then delegates', async () => {
    prisma.finding.findMany.mockResolvedValue([emailFinding]);
    prisma.inquiry.findMany.mockResolvedValue([
      inquiry({ findingTypes: ['email'] }),
    ]);

    const watched = await service.watchedBy(['f1', 'gone']);

    // A stale id is simply absent — this must never throw on one.
    expect([...watched.keys()]).toEqual(['f1']);
  });
});
