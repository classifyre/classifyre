import { Test, TestingModule } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { InquiryMatchingService } from './inquiry-matching.service';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { InquiryActivityService } from '../inquiry-activity.service';
import { AUTO_PULL_ACTOR, CASE_PULL } from '../cases/case-pull.port';

/**
 * Auto-pull: a standing question topping up the case it drives, by itself.
 *
 * Two things have to hold. It must never fail the run — the counters are
 * already committed by the time it runs, and a case that could not be topped up
 * is not a reason to retry a whole match pass. And it must stay bounded in
 * ASSETS: pullFromInquiry rebuilds lineage edges once per distinct asset, and
 * this runs inside the matching worker at localConcurrency 1, so an unbounded
 * pull stalls matching for every other inquiry in the workspace.
 */
describe('auto-pull into linked cases', () => {
  let service: InquiryMatchingService;

  const ANCHOR_AT = new Date('2026-09-20T10:00:00Z');
  const AFTER = new Date('2026-09-20T11:00:00Z');

  const mockPrisma = {
    inquiry: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    finding: { findMany: jest.fn(), count: jest.fn() },
    runner: { findUnique: jest.fn() },
    source: { findMany: jest.fn() },
    caseInquiry: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const mockPull = { pullFromInquiry: jest.fn() };
  const mockActivity = { record: jest.fn(), tryRecord: jest.fn() };

  const inquiry = (over: Record<string, unknown> = {}) => ({
    id: 'q1',
    title: 'Board travel',
    matchAllSources: false,
    sourceIds: ['s1'],
    detectorTypes: [],
    customDetectorKeys: [],
    findingTypes: ['email'],
    findingTypeRegex: [],
    findingValueRegex: [],
    matchCount: 0,
    newMatchCount: 0,
    goneMatchCount: 0,
    createdBy: 'someone',
    ...over,
  });

  /** `count` matching findings the latest run created, one asset apiece. */
  const newFindings = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `f${i}`,
      assetId: `a${i}`,
      sourceId: 's1',
      detectorType: 'PII',
      customDetectorKey: null,
      findingType: 'email',
      severity: 'HIGH',
      matchedContent: `user${i}@example.com`,
      createdAt: AFTER,
    }));

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InquiryMatchingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PgBossService, useValue: {} },
        { provide: InquiryActivityService, useValue: mockActivity },
        { provide: CASE_PULL, useValue: mockPull },
        {
          provide: ModuleRef,
          useValue: {
            get: (token: unknown) => (token === CASE_PULL ? mockPull : null),
          },
        },
      ],
    }).compile();
    service = module.get(InquiryMatchingService);
    jest.clearAllMocks();
    mockPrisma.inquiry.update.mockResolvedValue({});
    mockPrisma.runner.findUnique.mockResolvedValue(null);
    mockPrisma.source.findMany.mockResolvedValue([{ id: 's1' }]);
    mockPrisma.$queryRaw.mockResolvedValue([
      { sourceId: 's1', runnerId: 'run-latest', startedAt: ANCHOR_AT },
    ]);
    mockPrisma.inquiry.findMany.mockResolvedValue([inquiry()]);
    mockPull.pullFromInquiry.mockResolvedValue({ pulled: 1 });
  });

  /** One open case that asked for automatic top-ups. */
  function linkedCase() {
    mockPrisma.caseInquiry.findMany.mockResolvedValue([
      { caseId: 'c1', autoPull: true, case: { title: 'Travel spend' } },
    ]);
  }

  it("pulls the run's new matches into a case that asked for them", async () => {
    linkedCase();
    mockPrisma.finding.findMany.mockResolvedValue(newFindings(3));

    await service.processSourceCompletion('s1', 'run-latest');

    expect(mockPull.pullFromInquiry).toHaveBeenCalledWith(
      'c1',
      { inquiryId: 'q1', findingIds: ['f0', 'f1', 'f2'] },
      AUTO_PULL_ACTOR,
      // The scan that landed them, for the case timeline.
      { sourceId: 's1', runnerId: 'run-latest' },
    );
  });

  // A finding the scans stopped seeing was resolved, and a case that removes
  // what is gone let it go. When a later scan detects it again the row is
  // re-opened, not created: it is not NEW, and before this it was never pulled
  // back — a company whose warning returned stayed out of the case watching
  // for it.
  it('pulls a finding the run re-opened back in, without counting it as new', async () => {
    linkedCase();
    const BEFORE = new Date('2026-09-01T09:00:00Z');
    const old = { ...newFindings(1)[0], id: 'back', createdAt: BEFORE };
    mockPrisma.finding.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        where?.history
          ? [old] // re-opened by this run
          : where?.createdAt
            ? [] // created by this run: nothing
            : where?.status === 'RESOLVED'
              ? [] // retired by this run: nothing
              : [old], // the open candidates, and the pull's own asset read
      ),
    );

    await service.processSourceCompletion('s1', 'run-latest');

    const reopened = mockPrisma.finding.findMany.mock.calls
      .map(([args]) => args.where)
      .find((where) => where?.history);
    expect(reopened).toMatchObject({
      sourceId: 's1',
      runnerId: 'run-latest',
      status: 'OPEN',
      history: { array_contains: [{ e: 'RO', r: 'run-latest' }] },
    });
    expect(mockPull.pullFromInquiry).toHaveBeenCalledWith(
      'c1',
      { inquiryId: 'q1', findingIds: ['back'] },
      AUTO_PULL_ACTOR,
      { sourceId: 's1', runnerId: 'run-latest' },
    );
    // Old row: the question's "new" counter does not move.
    const counters = mockPrisma.inquiry.update.mock.calls[0]?.[0]?.data;
    expect(counters?.newMatchCount ?? 0).toBe(0);
  });

  it('only considers open cases that opted in, or that escalate', async () => {
    linkedCase();
    mockPrisma.finding.findMany.mockResolvedValue(newFindings(1));

    await service.processSourceCompletion('s1', 'run-latest');

    const where = mockPrisma.caseInquiry.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { autoPull: true },
        { filters: { some: { action: 'ESCALATE' } } },
      ]),
    );
    expect(where.case.status.notIn).toEqual(
      expect.arrayContaining(['CLOSED', 'ARCHIVED']),
    );
  });

  it('pulls only escalating answers into a case with auto-add off', async () => {
    mockPrisma.caseInquiry.findMany.mockResolvedValue([
      { caseId: 'c2', autoPull: false, case: { title: 'Watched quietly' } },
    ]);
    mockPrisma.finding.findMany.mockResolvedValue(newFindings(2));
    mockPull.pullFromInquiry.mockResolvedValue({ pulled: 1 });

    await service.processSourceCompletion('s1', 'run-latest');

    expect(mockPull.pullFromInquiry).toHaveBeenCalledWith(
      'c2',
      { inquiryId: 'q1', findingIds: ['f0', 'f1'] },
      AUTO_PULL_ACTOR,
      { sourceId: 's1', runnerId: 'run-latest', onlyEscalating: true },
    );
  });

  it('caps a run by the number of distinct assets it would touch', async () => {
    linkedCase();
    mockPrisma.finding.findMany.mockResolvedValue(newFindings(400));

    await service.processSourceCompletion('s1', 'run-latest');

    const [, dto] = mockPull.pullFromInquiry.mock.calls[0];
    // One asset per finding here, so the asset cap is what binds.
    expect(dto.findingIds.length).toBe(100);
  });

  it('says on the timeline when it left some behind', async () => {
    linkedCase();
    mockPrisma.finding.findMany.mockResolvedValue(newFindings(400));

    await service.processSourceCompletion('s1', 'run-latest');

    const autoPulled = mockActivity.tryRecord.mock.calls.find(
      ([, type]) => type === 'AUTO_PULLED',
    );
    expect(autoPulled?.[2]).toEqual(
      expect.objectContaining({ capped: true, caseId: 'c1' }),
    );
  });

  it('does not fail the run when a pull throws', async () => {
    linkedCase();
    mockPrisma.finding.findMany.mockResolvedValue(newFindings(2));
    mockPull.pullFromInquiry.mockRejectedValue(new Error('case is locked'));

    await expect(
      service.processSourceCompletion('s1', 'run-latest'),
    ).resolves.toEqual({ landed: 2 });
  });

  it('stays out of a retire-driven recompute', async () => {
    // retire-out-of-scope refreshes the counters with no runnerId. That is
    // bookkeeping, not a scan, and must not move evidence into a case.
    linkedCase();
    mockPrisma.finding.findMany.mockResolvedValue(newFindings(2));

    await service.processSourceCompletion('s1', null);

    expect(mockPull.pullFromInquiry).not.toHaveBeenCalled();
  });

  it('does nothing when no linked case opted in', async () => {
    mockPrisma.caseInquiry.findMany.mockResolvedValue([]);
    mockPrisma.finding.findMany.mockResolvedValue(newFindings(2));

    await service.processSourceCompletion('s1', 'run-latest');

    expect(mockPull.pullFromInquiry).not.toHaveBeenCalled();
  });
});
