import { Injectable } from '@nestjs/common';
import { DetectorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { InquiryMatchingService } from '../matching/inquiry-matching.service';
import {
  CUSTOM_KEY_PREFIX,
  configuredDetectorKeysFromConfig,
  describeDetectorKey,
} from '../utils/detector-config-keys';
import {
  DETECTION_IMPACT_SCAN_LIMIT,
  UNMONITORED_MIN_IMPORTANCE,
} from './autopilot.constants';

/** What applying a candidate config to a source would cost. */
export interface DetectionImpact {
  /** Detector identities the change takes away, human-readable. */
  removedDetectors: string[];
  /** Detector identities the change adds. */
  addedDetectors: string[];
  /** Open findings the change orphans, and would resolve on the next scan. */
  resolves: {
    total: number;
    byDetector: Array<{ detector: string; count: number }>;
    /** Orphaned findings whose importance puts them in the top tier. */
    highImportance: number;
  };
  /**
   * Orphaned findings an investigation relies on. These are NOT resolved — the
   * ingest path exempts them — but the change still strips the detector that
   * keeps re-detecting them, so they stop being refreshed.
   */
  protectedEvidence: {
    total: number;
    citedByCases: Array<{ caseId: string; title: string; count: number }>;
    watchedByInquiries: Array<{
      inquiryId: string;
      title: string;
      count: number;
    }>;
  };
  /**
   * False when the per-row citation pass hit its scan cap, so `protectedEvidence`
   * is "what was found in the first N orphaned findings", not a complete answer.
   * `resolves.total` is always exact.
   */
  citationScanComplete: boolean;
}

const EMPTY_IMPACT: DetectionImpact = {
  removedDetectors: [],
  addedDetectors: [],
  resolves: { total: 0, byDetector: [], highImportance: 0 },
  protectedEvidence: { total: 0, citedByCases: [], watchedByInquiries: [] },
  citationScanComplete: true,
};

/**
 * Prices a detection change before it is made.
 *
 * A source's detector list is not a setting, it is the schema of its evidence
 * base: taking a detector out of the config resolves every open finding it
 * produced, and inquiries, cases, fingerprints and glossary terms are all built
 * on those findings. The config agent had no way to see that. Its tool returned
 * `{ok: true}` whether a change touched nothing or resolved 44,174 findings, so
 * every reduction looked free and it made 22 of them in three days.
 *
 * This computes the receipt. Nothing here writes.
 */
@Injectable()
export class DetectionImpactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inquiryMatching: InquiryMatchingService,
  ) {}

  /**
   * What changing `sourceId`'s config from its current state to `candidate`
   * would cost. Both configs must be decrypted.
   */
  async preview(
    sourceId: string,
    currentConfig: unknown,
    candidateConfig: unknown,
  ): Promise<DetectionImpact> {
    const [current, next] = await Promise.all([
      this.resolveKeys(currentConfig),
      this.resolveKeys(candidateConfig),
    ]);
    // An unreadable detector list on either side means we cannot say what
    // changed. Reporting "no impact" would be a lie in the dangerous
    // direction, so say nothing changed and let the caller's own guards apply.
    if (current === null || next === null) return EMPTY_IMPACT;

    const removed = [...current].filter((key) => !next.has(key));
    const added = [...next].filter((key) => !current.has(key));
    if (removed.length === 0) {
      return {
        ...EMPTY_IMPACT,
        addedDetectors: added.map(describeDetectorKey),
      };
    }

    const where = this.orphanedWhere(sourceId, removed);
    const [grouped, highImportance, sample] = await Promise.all([
      this.prisma.finding.groupBy({
        by: ['detectorType', 'customDetectorKey'],
        where,
        _count: true,
      }),
      this.prisma.finding.count({
        where: {
          ...where,
          importanceScore: { gte: UNMONITORED_MIN_IMPORTANCE },
        },
      }),
      this.prisma.finding.findMany({
        where,
        // Deterministic window so two previews of the same change agree.
        orderBy: { id: 'asc' },
        take: DETECTION_IMPACT_SCAN_LIMIT,
        select: {
          id: true,
          sourceId: true,
          detectorType: true,
          findingType: true,
          customDetectorKey: true,
          matchedContent: true,
        },
      }),
    ]);

    const byDetector = grouped
      .map((row) => ({
        detector: describeDetectorKey(
          row.detectorType === DetectorType.CUSTOM && row.customDetectorKey
            ? `${CUSTOM_KEY_PREFIX}${row.customDetectorKey}`
            : String(row.detectorType),
        ),
        count: row._count,
      }))
      .sort((a, b) => b.count - a.count);
    const total = byDetector.reduce((sum, row) => sum + row.count, 0);

    const protectedEvidence = await this.citations(sample);

    return {
      removedDetectors: removed.map(describeDetectorKey),
      addedDetectors: added.map(describeDetectorKey),
      resolves: { total, byDetector, highImportance },
      protectedEvidence,
      citationScanComplete: sample.length < DETECTION_IMPACT_SCAN_LIMIT,
    };
  }

  /** One-line summary for an operator notification or a tool result. */
  static describe(impact: DetectionImpact): string {
    if (impact.resolves.total === 0) {
      return impact.addedDetectors.length > 0
        ? `Adds ${impact.addedDetectors.join(', ')}; resolves no existing findings.`
        : 'No existing findings are affected.';
    }
    const parts = [
      `Removes ${impact.removedDetectors.join(', ')}, resolving ` +
        `${impact.resolves.total} open finding(s)`,
    ];
    if (impact.resolves.highImportance > 0) {
      parts.push(`${impact.resolves.highImportance} of them high-importance`);
    }
    if (impact.protectedEvidence.total > 0) {
      parts.push(
        `${impact.protectedEvidence.total} kept because an investigation cites them`,
      );
    }
    return `${parts.join('; ')}.`;
  }

  // ─── Private ─────────────────────────────────────────────────────

  /** Configured detector identities, with legacy custom-detector ids resolved. */
  private async resolveKeys(config: unknown): Promise<Set<string> | null> {
    const parsed = configuredDetectorKeysFromConfig(config);
    if (parsed === null) return null;
    const { keys, legacyCustomIds } = parsed;
    if (legacyCustomIds.length > 0) {
      const rows = await this.prisma.customDetector.findMany({
        where: { id: { in: legacyCustomIds } },
        select: { key: true },
      });
      for (const row of rows) keys.add(`${CUSTOM_KEY_PREFIX}${row.key}`);
    }
    return keys;
  }

  /**
   * Open findings on this source produced by any of the removed detectors.
   *
   * Findings an operator manually resolved or dismissed are also exempt from
   * the ingest cleanup, and are not excluded here — reading each row's history
   * to find out would cost more than the preview is worth, and over-stating the
   * cost of a destructive change errs in the safe direction.
   */
  private orphanedWhere(
    sourceId: string,
    removed: string[],
  ): Prisma.FindingWhereInput {
    const builtIns = removed.filter((k) => !k.startsWith(CUSTOM_KEY_PREFIX));
    const customKeys = removed
      .filter((k) => k.startsWith(CUSTOM_KEY_PREFIX))
      .map((k) => k.slice(CUSTOM_KEY_PREFIX.length));

    return {
      sourceId,
      status: 'OPEN',
      OR: [
        ...(builtIns.length > 0
          ? [{ detectorType: { in: builtIns as DetectorType[] } }]
          : []),
        ...(customKeys.length > 0
          ? [{ customDetectorKey: { in: customKeys } }]
          : []),
      ],
    };
  }

  /** Which of these orphaned findings a case cites or an active inquiry watches. */
  private async citations(
    sample: Array<{
      id: string;
      sourceId: string;
      detectorType: DetectorType;
      findingType: string;
      customDetectorKey: string | null;
      matchedContent: string | null;
    }>,
  ): Promise<DetectionImpact['protectedEvidence']> {
    if (sample.length === 0) {
      return { total: 0, citedByCases: [], watchedByInquiries: [] };
    }
    const ids = new Set(sample.map((f) => f.id));

    // case_findings is a small, human-curated table — read it whole rather
    // than sending a several-thousand-long IN list.
    const [caseFindings, watched] = await Promise.all([
      this.prisma.caseFinding.findMany({
        select: { findingId: true, caseId: true },
      }),
      this.inquiryMatching.watchersForFindings(sample),
    ]);

    const cited = new Set<string>();

    const byCase = new Map<string, number>();
    for (const row of caseFindings) {
      if (!ids.has(row.findingId)) continue;
      cited.add(row.findingId);
      byCase.set(row.caseId, (byCase.get(row.caseId) ?? 0) + 1);
    }

    const byInquiry = new Map<string, number>();
    for (const [findingId, inquiryIds] of watched) {
      cited.add(findingId);
      for (const inquiryId of inquiryIds) {
        byInquiry.set(inquiryId, (byInquiry.get(inquiryId) ?? 0) + 1);
      }
    }

    const [cases, inquiries] = await Promise.all([
      byCase.size > 0
        ? this.prisma.case.findMany({
            where: { id: { in: [...byCase.keys()] } },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
      byInquiry.size > 0
        ? this.prisma.inquiry.findMany({
            where: { id: { in: [...byInquiry.keys()] } },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
    ]);

    return {
      total: cited.size,
      citedByCases: cases
        .map((c) => ({
          caseId: c.id,
          title: c.title,
          count: byCase.get(c.id) ?? 0,
        }))
        .sort((a, b) => b.count - a.count),
      watchedByInquiries: inquiries
        .map((q) => ({
          inquiryId: q.id,
          title: q.title,
          count: byInquiry.get(q.id) ?? 0,
        }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
