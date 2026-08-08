import { DetectionPostureService } from './detection-posture.service';
import type { PrismaService } from '../prisma.service';
import type { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { computeDetectionFingerprint } from '../utils/scope-fingerprint';

/**
 * Where a source sits in its detection lifecycle, derived rather than stored.
 *
 * The distinction the harness lacked entirely: on day one, with nothing known,
 * flipping detectors is the correct behaviour; on day three, on a source whose
 * findings four inquiries are matching, it is how 96% of an evidence base gets
 * resolved one defensible step at a time.
 */
describe('DetectionPostureService', () => {
  const config = { detectors: [{ type: 'PII', enabled: true }] };
  const FINGERPRINT = computeDetectionFingerprint('S3', config);
  const OTHER = computeDetectionFingerprint('S3', {
    detectors: [{ type: 'SECRETS', enabled: true }],
  });

  const prisma = {
    source: { findUnique: jest.fn() },
    finding: { count: jest.fn() },
    runner: { count: jest.fn(), findMany: jest.fn() },
    agentDecision: { count: jest.fn(), findFirst: jest.fn() },
    // The cited-evidence count is a source-scoped SQL join, not a table read.
    $queryRaw: jest.fn(),
    inquiry: { findMany: jest.fn() },
  };
  const masked = { decryptMaskedConfig: jest.fn((c: unknown) => c) };
  const service = new DetectionPostureService(
    prisma as unknown as PrismaService,
    masked as unknown as MaskedConfigCryptoService,
  );

  /** N completed scans, all under the current detection set. */
  const settledRuns = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      detectionFingerprint: FINGERPRINT,
      completedAt: new Date(Date.UTC(2026, 7, 7, 12 - i)),
    }));

  beforeEach(() => {
    jest.clearAllMocks();
    masked.decryptMaskedConfig.mockImplementation((c) => c);
    prisma.source.findUnique.mockResolvedValue({
      id: 's1',
      type: 'S3',
      config,
    });
    prisma.finding.count.mockResolvedValue(5000);
    prisma.runner.count.mockResolvedValue(10);
    prisma.runner.findMany.mockResolvedValue(settledRuns(4));
    prisma.agentDecision.count.mockResolvedValue(0);
    prisma.agentDecision.findFirst.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([{ cited: 0n }]);
    prisma.inquiry.findMany.mockResolvedValue([]);
  });

  it('is EXPLORING before any scan has completed', async () => {
    prisma.runner.count.mockResolvedValue(0);
    prisma.runner.findMany.mockResolvedValue([]);

    const report = await service.forSource('s1');

    expect(report.posture).toBe('EXPLORING');
    expect(report.reason).toMatch(/no completed scan/);
  });

  it('is EXPLORING while the source has too few findings to judge', async () => {
    prisma.finding.count.mockResolvedValue(3);

    expect((await service.forSource('s1')).posture).toBe('EXPLORING');
  });

  it('is CONVERGING when detection settled but nothing uses its findings', async () => {
    const report = await service.forSource('s1');

    expect(report.posture).toBe('CONVERGING');
    expect(report.reason).toMatch(/nothing watches or cites/);
  });

  it('is STABLE once detection has held and its findings are in use', async () => {
    prisma.inquiry.findMany.mockResolvedValue([{ matchCount: 1075 }]);

    const report = await service.forSource('s1');

    expect(report.posture).toBe('STABLE');
    expect(report.inquiryMatches).toBe(1075);
    expect(report.scansSinceDetectionChanged).toBe(4);
  });

  // The guard against calling a set "settled" that was only just applied: a
  // change made after the last scan means the current set has run zero times.
  it('never reaches STABLE while detection keeps changing', async () => {
    prisma.inquiry.findMany.mockResolvedValue([{ matchCount: 1075 }]);
    prisma.runner.findMany.mockResolvedValue([
      { detectionFingerprint: FINGERPRINT, completedAt: new Date() },
      { detectionFingerprint: OTHER, completedAt: new Date() },
      { detectionFingerprint: FINGERPRINT, completedAt: new Date() },
    ]);

    const report = await service.forSource('s1');

    expect(report.posture).toBe('CONVERGING');
    expect(report.scansSinceDetectionChanged).toBe(1);
  });

  it('counts a change made after the last scan as unevaluated', async () => {
    prisma.runner.findMany.mockResolvedValue([
      {
        detectionFingerprint: FINGERPRINT,
        completedAt: new Date('2026-08-06T09:00:00Z'),
      },
    ]);
    prisma.agentDecision.findFirst.mockResolvedValue({
      createdAt: new Date('2026-08-06T09:48:00Z'),
    });

    expect((await service.forSource('s1')).lastChangeUnevaluated).toBe(true);
  });

  it('reports the remaining daily change budget', async () => {
    prisma.agentDecision.count.mockResolvedValue(3);

    const report = await service.forSource('s1');

    expect(report.tunesLast24h).toBe(3);
    expect(report.tuneBudgetRemaining).toBe(1);
  });

  // The join is scoped by source_id, so a case citing another source's finding
  // does not make this source's detection look used — and the count never
  // reads the whole case_findings table.
  it('counts findings cited by cases only when they belong to this source', async () => {
    prisma.$queryRaw.mockResolvedValue([{ cited: 1n }]);

    const report = await service.forSource('s1');

    expect(report.citedByCases).toBe(1);
    expect(report.posture).toBe('STABLE');
  });
});
