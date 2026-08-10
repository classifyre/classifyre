import { Injectable } from '@nestjs/common';
import {
  AssetStatus,
  AutoSchedulePhase,
  Prisma,
  RunnerStatus,
  SourceScheduleMode,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { InquiryMatchingService } from '../../matching/inquiry-matching.service';
import {
  CUSTOM_KEY_PREFIX,
  describeDetectorKey,
} from '../../utils/detector-config-keys';
import { citedFindingIds } from '../../utils/cited-findings';
import {
  ASSET_PROFILE_SCAN_LIMIT,
  MAX_ASSET_METADATA_KEY_BUCKETS,
  MAX_ASSET_METADATA_PREVIEW_KEYS,
  MAX_ASSET_METADATA_PREVIEW_LENGTH,
  MAX_ASSET_SAMPLES,
  MAX_ASSET_TYPE_BUCKETS,
  MAX_CANDIDATE_INQUIRIES,
  MAX_CASE_SUMMARIES,
  COVERAGE_UNAVAILABLE_FAILURE_STREAK,
  MAX_COVERAGE_SOURCE_ROWS,
  DETECTION_YIELD_SCANS,
  DETECTOR_VALUE_SCAN_LIMIT,
  UNMONITORED_MIN_IMPORTANCE,
  UNMONITORED_SCAN_LIMIT,
  MAX_DUPLICATE_CLUSTERS,
  MAX_DUPLICATE_PAIRS,
  MAX_FINDING_GROUPS,
  MAX_FINDINGS_PER_INQUIRY,
  MAX_SAMPLE_VALUES_PER_GROUP,
  MAX_SAMPLE_VALUE_LENGTH,
  MIN_FEEDBACK_FOR_PRECISION,
  NOISY_FALSE_POSITIVE_RATE,
  CLEAN_FALSE_POSITIVE_RATE,
} from '../autopilot.constants';
import type {
  AssetMetadataProfile,
  AssetSampleSummary,
  CaseSummary,
  CorpusCoverage,
  DetectorPrecisionSummary,
  DetectorValueSummary,
  DuplicateSummary,
  FindingGroupSummary,
  FocusedCaseDetail,
  InquirySummary,
  UnmonitoredFindings,
} from '../autopilot.types';

/**
 * Read-only search facade for the autopilot agents. Produces compact,
 * token-bounded summaries of findings, inquiries and cases so each LLM call
 * sees aggregates rather than raw rows.
 */
@Injectable()
export class AgentSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: InquiryMatchingService,
  ) {}

  /**
   * OPEN findings grouped and sampled. Scope narrows with what is given:
   * runner (scan delta) → source → the whole instance (manual full reviews).
   */
  async summarizeNewFindings(
    sourceId: string | null,
    runnerId: string | null,
    customDetectorKey?: string | null,
  ): Promise<FindingGroupSummary[]> {
    const where: Prisma.FindingWhereInput = runnerId
      ? { runnerId, status: 'OPEN' }
      : sourceId
        ? { sourceId, status: 'OPEN' }
        : { status: 'OPEN' };
    // Optional precision filter: isolate the findings a single custom detector
    // produced, so the agent can verify a detector it just authored.
    if (customDetectorKey) where.customDetectorKey = customDetectorKey;

    const rows = await this.prisma.finding.findMany({
      where,
      select: {
        id: true,
        assetId: true,
        detectorType: true,
        customDetectorKey: true,
        findingType: true,
        severity: true,
        matchedContent: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const groups = new Map<string, FindingGroupSummary>();
    for (const f of rows) {
      const key = `${String(f.detectorType)}|${f.customDetectorKey ?? ''}|${f.findingType}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          detectorType: String(f.detectorType),
          customDetectorKey: f.customDetectorKey,
          findingType: f.findingType,
          severity: String(f.severity),
          count: 0,
          sampleValues: [],
          sampleFindingIds: [],
          sampleAssetIds: [],
        };
        groups.set(key, g);
      }
      g.count++;
      if (
        g.sampleValues.length < MAX_SAMPLE_VALUES_PER_GROUP &&
        f.matchedContent
      ) {
        g.sampleValues.push(
          truncate(f.matchedContent, MAX_SAMPLE_VALUE_LENGTH),
        );
      }
      if (g.sampleFindingIds.length < MAX_SAMPLE_VALUES_PER_GROUP) {
        g.sampleFindingIds.push(f.id);
        g.sampleAssetIds.push(f.assetId);
      }
    }

    return [...groups.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_FINDING_GROUPS);
  }

  /**
   * Measured precision per ACTIVE custom detector, from operator triage.
   *
   * Every time an operator dismisses (FALSE_POSITIVE / IGNORED) or confirms
   * (RESOLVED) a custom-detector finding it is appended to CustomDetectorFeedback
   * — a durable log that survives re-scans (which rewrite the findings
   * themselves). We fold that log into a per-detector false-positive rate so the
   * DETECTOR_AUTHOR judges a detector on real dismissals rather than narrative.
   * Sorted noisiest-first; pass a key to score just one detector you authored.
   */
  async customDetectorPrecision(
    customDetectorKey?: string | null,
  ): Promise<DetectorPrecisionSummary[]> {
    const detectors = await this.prisma.customDetector.findMany({
      where: {
        isActive: true,
        ...(customDetectorKey ? { key: customDetectorKey } : {}),
      },
      select: { key: true, name: true },
    });
    if (detectors.length === 0) return [];

    const keys = detectors.map((d) => d.key);
    const [feedback, openFindings] = await Promise.all([
      // Cumulative operator triage — the durable dismissal signal.
      this.prisma.customDetectorFeedback.groupBy({
        by: ['customDetectorKey', 'status'],
        where: { customDetectorKey: { in: keys } },
        _count: true,
      }),
      // Current untriaged volume, so a rate is read against what is still open.
      this.prisma.finding.groupBy({
        by: ['customDetectorKey'],
        where: { customDetectorKey: { in: keys }, status: 'OPEN' },
        _count: true,
      }),
    ]);

    const openByKey = new Map<string, number>();
    for (const row of openFindings) {
      if (row.customDetectorKey) {
        openByKey.set(row.customDetectorKey, row._count);
      }
    }

    const dismissedByKey = new Map<string, number>();
    const confirmedByKey = new Map<string, number>();
    for (const row of feedback) {
      const target =
        row.status === 'FALSE_POSITIVE' || row.status === 'IGNORED'
          ? dismissedByKey
          : row.status === 'RESOLVED'
            ? confirmedByKey
            : null;
      if (target) {
        target.set(
          row.customDetectorKey,
          (target.get(row.customDetectorKey) ?? 0) + row._count,
        );
      }
    }

    return detectors
      .map((d) => {
        const dismissed = dismissedByKey.get(d.key) ?? 0;
        const confirmed = confirmedByKey.get(d.key) ?? 0;
        const reviewed = dismissed + confirmed;
        const falsePositiveRate =
          reviewed > 0 ? Math.round((dismissed / reviewed) * 100) / 100 : null;
        return {
          customDetectorKey: d.key,
          customDetectorName: d.name,
          openFindings: openByKey.get(d.key) ?? 0,
          dismissed,
          confirmed,
          reviewed,
          falsePositiveRate,
          verdict: classifyPrecision(reviewed, falsePositiveRate),
        };
      })
      .sort((a, b) => {
        // Best-evidenced first, then noisiest — surface actionable, well-
        // supported precision problems above small-sample (unproven) noise.
        const aProven = a.reviewed >= MIN_FEEDBACK_FOR_PRECISION;
        const bProven = b.reviewed >= MIN_FEEDBACK_FOR_PRECISION;
        if (aProven !== bProven) return aProven ? -1 : 1;
        const ra = a.falsePositiveRate ?? -1;
        const rb = b.falsePositiveRate ?? -1;
        return rb !== ra ? rb - ra : b.reviewed - a.reviewed;
      });
  }

  /**
   * Per-detector value: not how much a detector produces, but how much of what
   * it produces anyone is using.
   *
   * Covers built-ins as well as custom detectors. `detectors.precision` only
   * ever scored custom ones, so the built-in that held 44,174 of a source's
   * 49,671 findings had no value signal at all — and a detector with no value
   * signal and a large volume reads, to anything optimising a number, as noise.
   */
  async detectorValue(
    sourceId: string | null,
  ): Promise<DetectorValueSummary[]> {
    const where: Prisma.FindingWhereInput = {
      status: 'OPEN',
      ...(sourceId ? { sourceId } : {}),
    };

    const [counts, sample, caseFindings, feedback] = await Promise.all([
      this.prisma.finding.groupBy({
        by: ['detectorType', 'customDetectorKey'],
        where,
        _count: true,
      }),
      // The per-finding columns need rows, not aggregates. Bounded, ordered by
      // importance so a capped scan describes the part of the output that
      // matters rather than an arbitrary slice.
      this.prisma.finding.findMany({
        where,
        orderBy: { importanceScore: 'desc' },
        take: DETECTOR_VALUE_SCAN_LIMIT,
        select: {
          id: true,
          sourceId: true,
          detectorType: true,
          findingType: true,
          customDetectorKey: true,
          matchedContent: true,
          importanceScore: true,
        },
      }),
      citedFindingIds(this.prisma, sourceId),
      this.prisma.customDetectorFeedback.groupBy({
        by: ['customDetectorKey', 'status'],
        _count: true,
      }),
    ]);

    const watched = await this.matching.watchersForFindings(sample);
    const attached = caseFindings;

    const keyOf = (row: {
      detectorType: unknown;
      customDetectorKey: string | null;
    }): string =>
      String(row.detectorType) === 'CUSTOM' && row.customDetectorKey
        ? `${CUSTOM_KEY_PREFIX}${row.customDetectorKey}`
        : String(row.detectorType);

    const rows = new Map<string, DetectorValueSummary>();
    for (const row of counts) {
      const detector = keyOf(row);
      const existing = rows.get(detector);
      if (existing) {
        existing.openFindings += row._count;
        continue;
      }
      rows.set(detector, {
        detector,
        label: describeDetectorKey(detector),
        isCustom: detector.startsWith(CUSTOM_KEY_PREFIX),
        openFindings: row._count,
        watchedByInquiries: 0,
        citedByCases: 0,
        highImportance: 0,
        dismissedByOperator: 0,
        scanComplete: sample.length < DETECTOR_VALUE_SCAN_LIMIT,
      });
    }

    for (const finding of sample) {
      const entry = rows.get(keyOf(finding));
      if (!entry) continue;
      if (watched.has(finding.id)) entry.watchedByInquiries++;
      if (attached.has(finding.id)) entry.citedByCases++;
      if (finding.importanceScore >= UNMONITORED_MIN_IMPORTANCE) {
        entry.highImportance++;
      }
    }

    for (const row of feedback) {
      if (row.status !== 'FALSE_POSITIVE' && row.status !== 'IGNORED') continue;
      const entry = rows.get(`${CUSTOM_KEY_PREFIX}${row.customDetectorKey}`);
      if (entry) entry.dismissedByOperator += row._count;
    }

    // Most-used first: a detector nothing watches or cites belongs at the
    // bottom of this list whatever its volume, which is the whole point.
    return [...rows.values()].sort((a, b) => {
      const used =
        b.watchedByInquiries +
        b.citedByCases -
        (a.watchedByInquiries + a.citedByCases);
      return used !== 0 ? used : b.openFindings - a.openFindings;
    });
  }

  /**
   * Bounded, redacted sample of the raw assets in scope — name, kind and a
   * preview of their metadata. The cold-start signal: when a source has been
   * ingested but no detectors fired, this is the only material the harness has
   * to hypothesise what to detect. Scope narrows runner → source → instance.
   */
  async sampleAssets(
    sourceId: string | null,
    runnerId: string | null,
  ): Promise<AssetSampleSummary[]> {
    const where: Prisma.AssetWhereInput = runnerId
      ? { runnerId }
      : sourceId
        ? { sourceId }
        : {};
    const rows = await this.prisma.asset.findMany({
      where,
      select: {
        id: true,
        assetType: true,
        sourceType: true,
        name: true,
        externalUrl: true,
        metadata: true,
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_ASSET_SAMPLES,
    });
    return rows.map((a) => {
      const meta =
        a.metadata &&
        typeof a.metadata === 'object' &&
        !Array.isArray(a.metadata)
          ? (a.metadata as Record<string, unknown>)
          : {};
      const keys = Object.keys(meta);
      const preview: Record<string, string> = {};
      for (const key of keys.slice(0, MAX_ASSET_METADATA_PREVIEW_KEYS)) {
        preview[key] = previewValue(meta[key]);
      }
      return {
        id: a.id,
        assetType: a.assetType,
        sourceType: String(a.sourceType),
        name: truncate(a.name, MAX_SAMPLE_VALUE_LENGTH),
        url: a.externalUrl
          ? truncate(a.externalUrl, MAX_SAMPLE_VALUE_LENGTH)
          : null,
        metadataKeys: keys,
        metadataPreview: preview,
      };
    });
  }

  /**
   * Aggregate metadata profile of the assets in scope: asset/source kinds and
   * the most common metadata fields, plus whether any finding exists yet. The
   * CONFIG and DETECTOR_AUTHOR missions read this to bootstrap detection on a
   * source that has produced no findings.
   *
   * Always reports the source's live totals alongside the requested scope.
   * `asset.runnerId` names the *last* runner to touch an asset, so a
   * runner-scoped query against a superseded runner returns zero — which reads
   * exactly like an empty source, and was taken as one: a CONFIG run wrote a
   * false "0 assets and 0 findings" memory for a source holding 13 assets and
   * 3,239 findings, and triggered a pointless rescan off the back of it.
   */
  async assetMetadataProfile(
    sourceId: string | null,
    runnerId: string | null,
  ): Promise<AssetMetadataProfile> {
    const where: Prisma.AssetWhereInput = runnerId
      ? { runnerId }
      : sourceId
        ? { sourceId }
        : {};
    const scope: AssetMetadataProfile['scope'] = runnerId
      ? 'runner'
      : sourceId
        ? 'source'
        : 'instance';

    const [rows, findingCount, scopedAssetCount, sourceTotals] =
      await Promise.all([
        this.prisma.asset.findMany({
          where,
          select: { assetType: true, sourceType: true, metadata: true },
          take: ASSET_PROFILE_SCAN_LIMIT,
        }),
        this.prisma.finding.count({
          where: runnerId ? { runnerId } : sourceId ? { sourceId } : {},
        }),
        // A real count. totalAssets used to be rows.length — the sample size —
        // so any scope larger than ASSET_PROFILE_SCAN_LIMIT under-reported
        // itself and read as a smaller corpus than it is.
        this.prisma.asset.count({ where }),
        sourceId ? this.liveSourceTotals(sourceId) : Promise.resolve(null),
      ]);

    const assetTypes = new Map<string, number>();
    const sourceTypes = new Map<string, number>();
    const metadataKeys = new Map<string, number>();
    for (const a of rows) {
      bump(assetTypes, a.assetType);
      bump(sourceTypes, String(a.sourceType));
      if (
        a.metadata &&
        typeof a.metadata === 'object' &&
        !Array.isArray(a.metadata)
      ) {
        for (const key of Object.keys(a.metadata)) {
          bump(metadataKeys, key);
        }
      }
    }

    return {
      scope,
      totalAssets: scopedAssetCount,
      hasFindings: findingCount > 0,
      sourceTotals,
      runnerSuperseded:
        runnerId != null &&
        sourceTotals != null &&
        sourceTotals.activeAssets > scopedAssetCount,
      assetTypes: topBuckets(assetTypes, MAX_ASSET_TYPE_BUCKETS),
      sourceTypes: topBuckets(sourceTypes, MAX_ASSET_TYPE_BUCKETS),
      commonMetadataKeys: topBuckets(
        metadataKeys,
        MAX_ASSET_METADATA_KEY_BUCKETS,
      ),
    };
  }

  /**
   * The source's live state, independent of any runner. Deleted assets and
   * resolved findings are excluded: this answers "what does the source hold
   * right now", which is the question an agent is really asking when it reaches
   * for an asset profile.
   */
  private async liveSourceTotals(
    sourceId: string,
  ): Promise<{ activeAssets: number; openFindings: number }> {
    const [activeAssets, openFindings] = await Promise.all([
      this.prisma.asset.count({
        where: { sourceId, status: { not: AssetStatus.DELETED } },
      }),
      this.prisma.finding.count({ where: { sourceId, status: 'OPEN' } }),
    ]);
    return { activeAssets, openFindings };
  }

  /**
   * How much of the corpus has actually been scanned, per source.
   *
   * The investigation missions had no tool that could answer this: `sources.list`
   * lives in the config toolset, so INQUIRY, CASE and ESCALATION — the three
   * that create artifacts and page humans — could not see that 121 of 151
   * sources had never been scanned. `textCoverage` is included because a run can
   * report success while having read none of its assets' actual content, and
   * nothing in the harness exposed that either.
   */
  /**
   * How many OPEN findings carry an evidence-importance score.
   *
   * The honest measure of "can the agents trust findings.ranked right now",
   * replacing a proxy that read the embedding queue's state and was therefore
   * true throughout any sustained ingest.
   */
  async evidenceCoverage(): Promise<{ open: number; analyzed: number }> {
    const [open, analyzed] = await Promise.all([
      this.prisma.finding.count({ where: { status: 'OPEN' } }),
      this.prisma.finding.count({
        where: { status: 'OPEN', evidenceAnalysis: { isNot: null } },
      }),
    ]);
    return { open, analyzed };
  }

  async corpusCoverage(): Promise<CorpusCoverage> {
    const [sources, findingsOpen, findingsAnalyzed] = await Promise.all([
      this.prisma.source.findMany({
        select: {
          id: true,
          name: true,
          lastRunAt: true,
          lastRunStatus: true,
          runnerStatus: true,
          consecutiveFailures: true,
          scheduleMode: true,
          autoPhase: true,
          runners: {
            where: {
              status: { in: [RunnerStatus.COMPLETED, RunnerStatus.WARNING] },
            },
            orderBy: { completedAt: 'desc' },
            take: 1,
            select: {
              completedAt: true,
              status: true,
              assetsWithoutText: true,
              textCoverage: true,
            },
          },
        },
        orderBy: { name: 'asc' },
        take: MAX_COVERAGE_SOURCE_ROWS,
      }),
      this.prisma.finding.count({ where: { status: 'OPEN' } }),
      this.prisma.finding.count({
        where: { status: 'OPEN', importanceScore: { gt: 0 } },
      }),
    ]);

    // WARNING counts as scanned: partial OCR failure still ingested assets and
    // still fired a cycle, so excluding it would understate coverage.
    const rows = sources.map((s) => {
      const last = s.runners[0] ?? null;
      return {
        sourceId: s.id,
        name: s.name,
        scanned: last != null,
        lastRunAt: s.lastRunAt,
        lastRunStatus: s.lastRunStatus ? String(s.lastRunStatus) : null,
        runnerStatus: s.runnerStatus ? String(s.runnerStatus) : null,
        consecutiveFailures: s.consecutiveFailures,
        // Nothing will read this source: never scanned successfully AND either
        // repeatedly failing, paused by the adaptive scheduler, or not
        // scheduled at all. Reported per row so the config agent can see WHICH
        // ones, and excluded from the ratio so a handful of dead sources cannot
        // hold the whole corpus below the threshold forever (see
        // SystemBriefService.computeCoverage — this must agree with the brief,
        // or the agent is handed two different coverage numbers).
        unavailable:
          last == null &&
          (s.consecutiveFailures >= COVERAGE_UNAVAILABLE_FAILURE_STREAK ||
            s.scheduleMode === SourceScheduleMode.OFF ||
            (s.scheduleMode === SourceScheduleMode.AUTO &&
              s.autoPhase === AutoSchedulePhase.PAUSED)),
        assetsWithoutText: last?.assetsWithoutText ?? null,
        textCoverage: last?.textCoverage ?? null,
      };
    });

    const scanned = rows.filter((r) => r.scanned).length;
    const unavailable = rows.filter((r) => r.unavailable).length;
    const reachable = rows.length - unavailable;
    return {
      totalSources: rows.length,
      scannedSources: scanned,
      unavailableSources: unavailable,
      reachableSources: reachable,
      neverScanned: rows.filter((r) => r.lastRunAt == null).length,
      inFlight: rows.filter(
        (r) =>
          r.runnerStatus === RunnerStatus.PENDING ||
          r.runnerStatus === RunnerStatus.RUNNING,
      ).length,
      failing: rows.filter((r) => r.lastRunStatus === RunnerStatus.ERROR)
        .length,
      // Over REACHABLE sources, not all of them.
      coverageRatio:
        reachable > 0 ? Math.round((scanned / reachable) * 1000) / 1000 : 0,
      findingsOpen,
      findingsAnalyzed,
      note: [
        findingsAnalyzed < findingsOpen
          ? 'Evidence analysis is still catching up; unscored findings are pending, not unimportant.'
          : 'Every open finding has an evidence score.',
        unavailable > 0
          ? `${unavailable} source(s) cannot be scanned at all (switched off, paused, or failing every attempt) and are excluded from coverageRatio — see the "unavailable" flag per source. That is a configuration problem to raise, not evidence still on its way.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      sources: rows,
    };
  }

  /**
   * High-importance findings no active inquiry is watching.
   *
   * Delegates to the matching service, which owns the canonical matcher — the
   * answer has to agree with what an inquiry would actually select, not with a
   * second implementation of the same rules.
   */
  async unmonitoredFindings(): Promise<UnmonitoredFindings> {
    return this.matching.unmonitoredFindings(
      UNMONITORED_MIN_IMPORTANCE,
      UNMONITORED_SCAN_LIMIT,
    );
  }

  /**
   * Whether recent scans are still detecting anything.
   *
   * `blind` means every recent completed scan processed assets and produced no
   * finding at all — the source is being read and yielding nothing, which is a
   * detection-configuration failure rather than a quiet corpus. Scans that
   * processed no assets are ignored: they say nothing either way.
   */
  async detectionYield(): Promise<{
    scans: number;
    scansWithFindings: number;
    findingsCreated: number;
    blind: boolean;
  }> {
    const rows = await this.prisma.runner.findMany({
      where: { completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      take: DETECTION_YIELD_SCANS,
      select: {
        assetsCreated: true,
        assetsUpdated: true,
        assetsUnchanged: true,
        findingsCreated: true,
      },
    });
    const processed = rows.filter(
      (r) =>
        (r.assetsCreated ?? 0) +
          (r.assetsUpdated ?? 0) +
          (r.assetsUnchanged ?? 0) >
        0,
    );
    const findingsCreated = processed.reduce(
      (sum, r) => sum + (r.findingsCreated ?? 0),
      0,
    );
    return {
      scans: processed.length,
      scansWithFindings: processed.filter((r) => (r.findingsCreated ?? 0) > 0)
        .length,
      findingsCreated,
      blind: processed.length > 0 && findingsCreated === 0,
    };
  }

  /** All ACTIVE inquiries (capped) as compact summaries for dedupe/enrichment. */
  async listActiveInquiries(): Promise<InquirySummary[]> {
    const rows = await this.prisma.inquiry.findMany({
      where: { status: 'ACTIVE' },
      include: { caseLinks: { select: { caseId: true } } },
      orderBy: { updatedAt: 'desc' },
      take: MAX_CANDIDATE_INQUIRIES,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      aiMode: String(r.aiMode),
      matchAllSources: r.matchAllSources,
      sourceIds: r.sourceIds,
      detectorTypes: r.detectorTypes.map(String),
      customDetectorKeys: r.customDetectorKeys,
      findingTypes: r.findingTypes,
      findingTypeRegex: r.findingTypeRegex,
      findingValueRegex: r.findingValueRegex,
      matchCount: r.matchCount,
      newMatchCount: r.newMatchCount,
      linkedCaseIds: r.caseLinks.map((l) => l.caseId),
    }));
  }

  /**
   * Recently archived inquiries — intentionally closed topics the agent must
   * not blindly recreate.
   */
  async listRecentlyArchivedInquiries(): Promise<
    Array<{
      id: string;
      title: string;
      description: string | null;
      archivedAt: Date;
    }>
  > {
    const rows = await this.prisma.inquiry.findMany({
      where: { status: 'ARCHIVED' },
      select: { id: true, title: true, description: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 15,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      archivedAt: r.updatedAt,
    }));
  }

  /** Recently closed/archived cases with their conclusions — solved topics. */
  async listRecentlyClosedCases(): Promise<
    Array<{
      id: string;
      title: string;
      status: string;
      conclusion: string | null;
    }>
  > {
    const rows = await this.prisma.case.findMany({
      where: { status: { in: ['CLOSED', 'ARCHIVED'] } },
      select: { id: true, title: true, status: true, conclusion: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: String(r.status),
      conclusion: r.conclusion,
    }));
  }

  /** Open/in-progress cases (capped) as compact summaries. */
  async listOpenCases(): Promise<CaseSummary[]> {
    const rows = await this.prisma.case.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      include: {
        inquiryLinks: { select: { inquiryId: true } },
        threads: { where: { kind: 'HYPOTHESIS' }, select: { title: true } },
        _count: { select: { evidence: true, findings: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_CASE_SUMMARIES,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: String(r.status),
      severity: String(r.severity),
      aiMode: String(r.aiMode),
      linkedInquiryIds: r.inquiryLinks.map((l) => l.inquiryId),
      hypothesisTitles: r.threads.map((t) => t.title),
      evidenceCount: r._count.evidence,
      findingCount: r._count.findings,
    }));
  }

  /**
   * Full detail of one case for focused runs: hypotheses, evidence, findings
   * and graph edges — every id with bounded text so the model can target any
   * element from a natural-language instruction. Null when the case is gone.
   */
  async caseDetail(caseId: string): Promise<FocusedCaseDetail | null> {
    const row = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        inquiryLinks: { select: { inquiryId: true } },
        threads: {
          where: { kind: 'HYPOTHESIS' },
          include: { _count: { select: { support: true } } },
          orderBy: { createdAt: 'asc' },
        },
        evidence: {
          orderBy: { createdAt: 'asc' },
          take: 60,
        },
        findings: {
          orderBy: { createdAt: 'asc' },
          take: 100,
        },
      },
    });
    if (!row) return null;

    // Edges touching anything in the case (assets in evidence + findings).
    const assetIds = row.evidence
      .filter((e) => e.entityType === 'asset')
      .map((e) => e.entityId);
    const findingIds = row.findings.map((f) => f.findingId);
    const endpointIds = [...new Set([...assetIds, ...findingIds])];
    const [edges, glossary] = await Promise.all([
      endpointIds.length > 0
        ? this.prisma.edge.findMany({
            where: {
              OR: [
                { fromId: { in: endpointIds } },
                { toId: { in: endpointIds } },
              ],
            },
            orderBy: { createdAt: 'asc' },
            take: 150,
          })
        : Promise.resolve([]),
      this.prisma.glossaryReference.findMany({
        where: { entityType: 'case', entityId: caseId },
        include: { term: true },
        orderBy: { term: { term: 'asc' } },
        take: 100,
      }),
    ]);

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: String(row.status),
      severity: String(row.severity),
      hypotheses: row.threads.map((t) => ({
        threadId: t.id,
        title: t.title,
        status: t.status ? String(t.status) : null,
        confidence: t.confidence !== null ? Number(t.confidence) : null,
        supportCount: t._count.support,
      })),
      evidence: row.evidence.map((e) => ({
        evidenceId: e.id,
        assetId: e.entityId,
        label: e.label,
        note: e.note ? truncate(e.note, 200) : null,
      })),
      findings: row.findings.map((f) => ({
        caseFindingId: f.id,
        findingId: f.findingId,
        evidenceId: f.caseEvidenceId,
        label: f.label,
        severity: f.severity,
        detectorType: f.detectorType,
        matchedContent: f.matchedContent
          ? truncate(f.matchedContent, MAX_SAMPLE_VALUE_LENGTH)
          : null,
      })),
      edges: edges.map((e) => ({
        edgeId: e.id,
        fromType: e.fromType,
        fromId: e.fromId,
        toType: e.toType,
        toId: e.toId,
        relationType: e.relationType,
        origin: String(e.origin),
      })),
      glossary: glossary.map(({ term }) => ({
        id: term.id,
        term: term.term,
        aliases: term.aliases,
        entityType: String(term.entityType),
        notes: term.notes,
        verified: term.verifiedAt !== null,
      })),
      linkedInquiryIds: row.inquiryLinks.map((l) => l.inquiryId),
    };
  }

  /** Bounded sample of findings currently matching an inquiry. */
  async sampleInquiryMatches(inquiryId: string): Promise<
    Array<{
      findingId: string;
      assetId: string;
      label: string;
      severity: string;
      detectorType: string;
      value?: string;
    }>
  > {
    const matches = await this.matching.getLiveMatches(inquiryId, {
      limit: MAX_FINDINGS_PER_INQUIRY,
    });
    return matches.items.map((m) => ({
      findingId: m.findingId,
      assetId: m.assetId,
      label: m.label,
      severity: m.severity ?? 'UNKNOWN',
      detectorType: m.detectorType ?? 'UNKNOWN',
      value: m.matchedContent
        ? truncate(m.matchedContent, MAX_SAMPLE_VALUE_LENGTH)
        : undefined,
    }));
  }

  /** Existence checks used by the decision applier as a hallucination guard. */
  async existingIds(
    model: 'inquiry' | 'case' | 'finding' | 'asset' | 'caseThread',
    ids: string[],
  ): Promise<Set<string>> {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return new Set();
    const where = { id: { in: unique } } as const;
    const select = { id: true } as const;
    let rows: Array<{ id: string }>;
    switch (model) {
      case 'inquiry':
        rows = await this.prisma.inquiry.findMany({ where, select });
        break;
      case 'case':
        rows = await this.prisma.case.findMany({ where, select });
        break;
      case 'finding':
        rows = await this.prisma.finding.findMany({ where, select });
        break;
      case 'asset':
        rows = await this.prisma.asset.findMany({ where, select });
        break;
      case 'caseThread':
        rows = await this.prisma.caseThread.findMany({ where, select });
        break;
    }
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Compact summary of the duplicate/cluster results the DUPLICATES FINDER
   * AGENT produced for this scan. Read directly from the correlation tables
   * (no module dependency on CorrelationService → no circular import). Scope:
   * the assets touched by the runner, narrowing to source, else instance-wide.
   */
  async summarizeDuplicatesForRunner(
    sourceId: string | null,
    runnerId: string | null,
  ): Promise<DuplicateSummary> {
    const assetWhere: Prisma.AssetWhereInput = runnerId
      ? { runnerId }
      : sourceId
        ? { sourceId }
        : {};
    const assets = await this.prisma.asset.findMany({
      where: assetWhere,
      select: { id: true },
      take: 5000,
    });
    const assetIds = assets.map((a) => a.id);
    if (assetIds.length === 0) return { clusters: [], topPairs: [] };

    // Clusters these assets belong to.
    const members = await this.prisma.assetClusterMember.findMany({
      where: { assetId: { in: assetIds } },
      select: { clusterId: true },
    });
    const clusterIds = [...new Set(members.map((m) => m.clusterId))];
    const clusterRows = await this.prisma.assetCluster.findMany({
      where: { id: { in: clusterIds } },
      orderBy: { memberCount: 'desc' },
      take: MAX_DUPLICATE_CLUSTERS,
    });

    // Top correlation edges touching these assets.
    const edges = await this.prisma.edge.findMany({
      where: {
        fromType: 'asset',
        toType: 'asset',
        relationType: { in: ['related', 'likely_duplicate'] },
        OR: [{ fromId: { in: assetIds } }, { toId: { in: assetIds } }],
      },
      orderBy: { confidence: 'desc' },
      take: MAX_DUPLICATE_PAIRS,
    });

    return {
      clusters: clusterRows.map((c) => ({
        clusterId: c.id,
        memberCount: c.memberCount,
        sourceCount: c.sourceCount,
        label: c.label,
        commonValues: Array.isArray(c.topValues)
          ? (
              c.topValues as Array<{
                label: string;
                value: string;
                count: number;
              }>
            ).slice(0, 5)
          : [],
      })),
      topPairs: edges.map((e) => {
        const meta = (e.metadata ?? {}) as {
          weighted?: number;
          reasons?: string[];
        };
        return {
          fromAssetId: e.fromId,
          toAssetId: e.toId,
          relationType: e.relationType,
          matchPercent: Math.round(
            (meta.weighted ?? Number(e.confidence)) * 100,
          ),
          reasons: meta.reasons ?? [],
        };
      }),
    };
  }

  async sourceName(sourceId: string): Promise<string> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { name: true },
    });
    return source?.name ?? sourceId;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Coarse, sample-aware label for a detector's false-positive rate. Too few
 * operator reviews → "unproven" (do not judge on one dismissal); otherwise
 * "noisy" / "clean" at the thresholds, "mixed" in between.
 */
function classifyPrecision(
  reviewed: number,
  rate: number | null,
): DetectorPrecisionSummary['verdict'] {
  if (rate === null || reviewed < MIN_FEEDBACK_FOR_PRECISION) return 'unproven';
  if (rate >= NOISY_FALSE_POSITIVE_RATE) return 'noisy';
  if (rate <= CLEAN_FALSE_POSITIVE_RATE) return 'clean';
  return 'mixed';
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Highest-count entries of a tally, descending, capped. */
function topBuckets(
  map: Map<string, number>,
  limit: number,
): Array<{ type: string; count: number }> {
  return [...map.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Compact, redacted preview of a metadata value (structure, not full content). */
function previewValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    const head = value
      .slice(0, 5)
      .map((v) => (typeof v === 'object' ? '{…}' : String(v)))
      .join(', ');
    return truncate(
      `[${head}${value.length > 5 ? ', …' : ''}]`,
      MAX_ASSET_METADATA_PREVIEW_LENGTH,
    );
  }
  if (typeof value === 'object') return '{…}';
  if (typeof value === 'string') {
    return truncate(value, MAX_ASSET_METADATA_PREVIEW_LENGTH);
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return truncate(String(value), MAX_ASSET_METADATA_PREVIEW_LENGTH);
  }
  // symbol / function — no useful preview.
  return '';
}
