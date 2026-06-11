import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { InquiryMatchingService } from '../../matching/inquiry-matching.service';
import {
  MAX_CANDIDATE_INQUIRIES,
  MAX_CASE_SUMMARIES,
  MAX_FINDING_GROUPS,
  MAX_FINDINGS_PER_INQUIRY,
  MAX_SAMPLE_VALUES_PER_GROUP,
  MAX_SAMPLE_VALUE_LENGTH,
} from '../autopilot.constants';
import type {
  CaseSummary,
  FindingGroupSummary,
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

  /** New OPEN findings of a run (fallback: the source), grouped and sampled. */
  async summarizeNewFindings(
    sourceId: string,
    runnerId: string | null,
  ): Promise<FindingGroupSummary[]> {
    const where: Prisma.FindingWhereInput = runnerId
      ? { runnerId, status: 'OPEN' }
      : { sourceId, status: 'OPEN' };

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
    const matches = await this.matching.getLiveMatches(inquiryId);
    return matches.slice(0, MAX_FINDINGS_PER_INQUIRY).map((m) => ({
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
