import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { InquiryMatchingService } from '../../matching/inquiry-matching.service';
import {
  MAX_CANDIDATE_INQUIRIES,
  MAX_CASE_SUMMARIES,
  MAX_DUPLICATE_CLUSTERS,
  MAX_DUPLICATE_PAIRS,
  MAX_FINDING_GROUPS,
  MAX_FINDINGS_PER_INQUIRY,
  MAX_SAMPLE_VALUES_PER_GROUP,
  MAX_SAMPLE_VALUE_LENGTH,
} from '../autopilot.constants';
import type {
  CaseSummary,
  DuplicateSummary,
  FindingGroupSummary,
  FocusedCaseDetail,
  InquirySummary,
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
  ): Promise<FindingGroupSummary[]> {
    const where: Prisma.FindingWhereInput = runnerId
      ? { runnerId, status: 'OPEN' }
      : sourceId
        ? { sourceId, status: 'OPEN' }
        : { status: 'OPEN' };

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
    const edges =
      endpointIds.length > 0
        ? await this.prisma.edge.findMany({
            where: {
              OR: [
                { fromId: { in: endpointIds } },
                { toId: { in: endpointIds } },
              ],
            },
            orderBy: { createdAt: 'asc' },
            take: 150,
          })
        : [];

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
