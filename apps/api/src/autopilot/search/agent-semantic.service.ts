import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { EmbeddingService } from '../../embedding/embedding.service';
import { QueryEmbeddingService } from '../../embedding/query-embedding.service';
import { MAX_SAMPLE_VALUE_LENGTH } from '../autopilot.constants';

const MAX_RANKED_FINDINGS = 25;
const MAX_SEMANTIC_RESULTS = 15;
const MAX_SIMILAR_RESULTS = 10;
const MAX_BOILERPLATE_CLUSTERS = 10;

type Reason = { code: string; label: string; impact: string };

type CompactRankedFinding = {
  findingId: string;
  assetId: string;
  findingType: string;
  severity: string;
  status: string;
  value: string;
  importance: number | null;
  quality: number | null;
  similarCount: number;
  reasons: string[];
  semanticSimilarity?: number;
};

/**
 * Semantic/ranking facade for the autopilot agents. Same contract as the rest
 * of AgentSearchService: compact, token-bounded summaries — never raw rows or
 * vectors. Similarity and importance are retrieval/triage signals, not proof.
 */
@Injectable()
export class AgentSemanticService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingService,
    private readonly queryEmbedding: QueryEmbeddingService,
  ) {}

  private reasonCodes(reasons: unknown): string[] {
    if (!Array.isArray(reasons)) return [];
    return (reasons as Reason[])
      .filter((reason) => reason && typeof reason.code === 'string')
      .map((reason) =>
        reason.impact === 'down'
          ? `${reason.code}(down)`
          : reason.impact === 'up'
            ? `${reason.code}(up)`
            : reason.code,
      );
  }

  private round(value: number | null | undefined): number | null {
    return value === null || value === undefined
      ? null
      : Math.round(value * 100) / 100;
  }

  /**
   * Top OPEN findings by evidence importance (corpus-relative, explained),
   * de-duplicated to one representative per duplicate group.
   */
  async rankedFindings(
    sourceId: string | null,
    limit = MAX_RANKED_FINDINGS,
  ): Promise<{ coverage: string; findings: CompactRankedFinding[] }> {
    const where: Prisma.FindingWhereInput = {
      status: 'OPEN',
      ...(sourceId ? { sourceId } : {}),
    };
    const [total, analyzed] = await Promise.all([
      this.prisma.finding.count({ where }),
      this.prisma.finding.count({
        where: { ...where, evidenceAnalysis: { isNot: null } },
      }),
    ]);
    const rows = await this.prisma.finding.findMany({
      where: { ...where, evidenceAnalysis: { isNot: null } },
      include: { evidenceAnalysis: true },
      orderBy: { evidenceAnalysis: { importanceScore: 'desc' } },
      take: Math.min(limit, MAX_RANKED_FINDINGS) * 3,
    });
    const seenGroups = new Set<string>();
    const findings: CompactRankedFinding[] = [];
    for (const row of rows) {
      const group = row.evidenceAnalysis?.duplicateGroupHash;
      if (group) {
        if (seenGroups.has(group)) continue;
        seenGroups.add(group);
      }
      findings.push({
        findingId: row.id,
        assetId: row.assetId,
        findingType: row.findingType,
        severity: String(row.severity),
        status: String(row.status),
        value: truncate(row.matchedContent, MAX_SAMPLE_VALUE_LENGTH),
        importance: this.round(row.evidenceAnalysis?.importanceScore ?? null),
        quality: this.round(row.evidenceAnalysis?.qualityScore ?? null),
        similarCount: row.evidenceAnalysis?.similarCount ?? 0,
        reasons: this.reasonCodes(row.evidenceAnalysis?.reasons),
      });
      if (findings.length >= Math.min(limit, MAX_RANKED_FINDINGS)) break;
    }
    return {
      coverage:
        total === 0
          ? 'no open findings in scope'
          : `${analyzed}/${total} open findings analyzed; unanalyzed ones are pending, not unimportant`,
      findings,
    };
  }

  /** Free-text semantic search over finding evidence. */
  async semanticSearch(
    query: string,
    sourceId: string | null,
    limit = MAX_SEMANTIC_RESULTS,
  ): Promise<{ unavailable: string } | { findings: CompactRankedFinding[] }> {
    let vector: number[];
    try {
      vector = await this.queryEmbedding.embed(query);
    } catch (error) {
      return {
        unavailable: `semantic search unavailable (${
          error instanceof Error ? error.message : String(error)
        }); use findings.ranked or findings.search instead`,
      };
    }
    const rows = await this.embeddings.semanticFindingIds(
      vector,
      Math.min(limit, MAX_SEMANTIC_RESULTS),
      sourceId ? [sourceId] : undefined,
    );
    const records = await this.prisma.finding.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      include: { evidenceAnalysis: true },
    });
    const byId = new Map(records.map((record) => [record.id, record]));
    return {
      findings: rows.flatMap((row) => {
        const record = byId.get(row.id);
        if (!record) return [];
        return [
          {
            findingId: record.id,
            assetId: record.assetId,
            findingType: record.findingType,
            severity: String(record.severity),
            status: String(record.status),
            value: truncate(record.matchedContent, MAX_SAMPLE_VALUE_LENGTH),
            importance: this.round(
              record.evidenceAnalysis?.importanceScore ?? null,
            ),
            quality: this.round(record.evidenceAnalysis?.qualityScore ?? null),
            similarCount: record.evidenceAnalysis?.similarCount ?? 0,
            reasons: this.reasonCodes(record.evidenceAnalysis?.reasons),
            semanticSimilarity: this.round(Number(row.score)) ?? undefined,
          },
        ];
      }),
    };
  }

  /** Semantic neighbours of one finding — lead expansion, not proof. */
  async similarFindings(findingId: string, limit = MAX_SIMILAR_RESULTS) {
    const rows = await this.embeddings.similarFindings(
      findingId,
      Math.min(limit, MAX_SIMILAR_RESULTS),
    );
    return rows.map((row) => ({
      findingId: row.id,
      assetId: row.assetId,
      sourceId: row.sourceId,
      findingType: row.findingType,
      severity: String(row.severity),
      status: String(row.status),
      value: truncate(row.matchedContent, MAX_SAMPLE_VALUE_LENGTH),
      similarity: this.round(row.similarity),
      importance: this.round(row.evidenceAnalysis?.importanceScore ?? null),
      reasons: this.reasonCodes(row.evidenceAnalysis?.reasons),
    }));
  }

  /** Full evidence-ranking explanation for one finding. */
  async explainFinding(findingId: string) {
    const finding = await this.prisma.finding.findUnique({
      where: { id: findingId },
      include: { evidenceAnalysis: true },
    });
    if (!finding) return { error: `finding ${findingId} not found` };
    const analysis = finding.evidenceAnalysis;
    const duplicates = analysis?.duplicateGroupHash
      ? await this.prisma.findingEvidenceAnalysis.count({
          where: { duplicateGroupHash: analysis.duplicateGroupHash },
        })
      : 1;
    return {
      findingId: finding.id,
      assetId: finding.assetId,
      sourceId: finding.sourceId,
      findingType: finding.findingType,
      value: truncate(finding.matchedContent, MAX_SAMPLE_VALUE_LENGTH),
      detectorSeverity: String(finding.severity),
      detectorConfidence: Number(finding.confidence),
      ranking: analysis
        ? {
            importance: this.round(analysis.importanceScore),
            quality: this.round(analysis.qualityScore),
            semanticOutlier: this.round(analysis.semanticOutlier),
            similarCount: analysis.similarCount,
            duplicateGroupSize: duplicates,
            reasons: Array.isArray(analysis.reasons) ? analysis.reasons : [],
            signals:
              analysis.signals && typeof analysis.signals === 'object'
                ? analysis.signals
                : {},
          }
        : { coverage: 'pending — not yet analyzed against the corpus' },
      note: 'Detector severity and evidence importance are independent axes; treat importance as triage guidance, not proof.',
    };
  }

  /**
   * Near-duplicate boilerplate clusters — usually noise to skip, but a
   * cluster spanning several sources (sourceCount > 1) means the same content
   * circulates between systems and may itself be a lead.
   */
  async boilerplateClusters(sourceId?: string, threshold = 0.95) {
    const clusters = await this.embeddings.boilerplateClusters({
      sourceIds: sourceId ? [sourceId] : undefined,
      threshold,
      limit: MAX_BOILERPLATE_CLUSTERS,
    });
    if (!clusters.length) return { clusters: [] };
    const sampleIds = clusters
      .map((cluster) => cluster.findingIds[0])
      .filter(Boolean);
    const samples = await this.prisma.finding.findMany({
      where: { id: { in: sampleIds } },
      select: { id: true, matchedContent: true, findingType: true },
    });
    const byId = new Map(samples.map((sample) => [sample.id, sample]));
    return {
      clusters: clusters.map((cluster) => {
        const sample = byId.get(cluster.findingIds[0]);
        return {
          groupHash: cluster.groupHash,
          findingCount: cluster.findingCount,
          sourceCount: cluster.sourceCount,
          meanImportance: this.round(cluster.meanImportance),
          sampleFindingId: cluster.findingIds[0],
          sampleType: sample?.findingType,
          sampleValue: sample
            ? truncate(sample.matchedContent, MAX_SAMPLE_VALUE_LENGTH)
            : undefined,
        };
      }),
    };
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
