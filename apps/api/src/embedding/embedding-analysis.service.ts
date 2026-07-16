import { Injectable } from '@nestjs/common';
import { Severity } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type Reason = {
  code: string;
  label: string;
  impact: 'up' | 'down' | 'neutral';
};

@Injectable()
export class EmbeddingAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  private textQuality(text: string): number {
    if (!text.trim()) return 0;
    const characters = [...text];
    const readable = characters.filter((char) =>
      /[\p{L}\p{N}\s.,:;!?@+'"()-]/u.test(char),
    ).length;
    const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const diversity = tokens.length ? new Set(tokens).size / tokens.length : 0;
    const replacementPenalty = Math.min(
      0.5,
      (text.match(/[�]/g)?.length ?? 0) / 5,
    );
    return Math.max(
      0,
      Math.min(
        1,
        (readable / characters.length) * 0.7 +
          diversity * 0.3 -
          replacementPenalty,
      ),
    );
  }

  private severityWeight(severity: Severity): number {
    return { CRITICAL: 1, HIGH: 0.8, MEDIUM: 0.55, LOW: 0.3, INFO: 0.15 }[
      severity
    ];
  }

  async analyzeHashes(spaceId: string, contentHashes: string[]): Promise<void> {
    if (!contentHashes.length) return;
    const findings = await this.prisma.finding.findMany({
      where: { embedContentHash: { in: contentHashes } },
      select: {
        id: true,
        embedContentHash: true,
        severity: true,
        confidence: true,
        matchedContent: true,
        contextBefore: true,
        contextAfter: true,
      },
    });
    const counts = new Map<string, number>();
    for (const finding of findings) {
      if (finding.embedContentHash) {
        counts.set(
          finding.embedContentHash,
          (counts.get(finding.embedContentHash) ?? 0) + 1,
        );
      }
    }

    await Promise.all(
      findings.map(async (finding) => {
        const hash = finding.embedContentHash as string;
        const similarCount = Math.max(0, (counts.get(hash) ?? 1) - 1);
        const context = [
          finding.contextBefore,
          finding.matchedContent,
          finding.contextAfter,
        ]
          .filter(Boolean)
          .join(' ');
        const qualityScore = this.textQuality(context);
        const contextScore = Math.min(1, context.length / 320);
        const noveltyScore = 1 / Math.sqrt(similarCount + 1);
        const importanceScore =
          Math.round(
            (qualityScore * 0.3 +
              Number(finding.confidence) * 0.2 +
              noveltyScore * 0.25 +
              contextScore * 0.15 +
              this.severityWeight(finding.severity) * 0.1) *
              1000,
          ) / 1000;
        const reasons: Reason[] = [];
        reasons.push(
          qualityScore < 0.45
            ? {
                code: 'ocr_fragment',
                label: 'Possible OCR fragment',
                impact: 'down',
              }
            : {
                code: 'readable_context',
                label: 'Readable supporting context',
                impact: 'up',
              },
        );
        reasons.push(
          similarCount > 0
            ? {
                code: 'duplicate_group',
                label: `${similarCount} identical findings grouped`,
                impact: 'down',
              }
            : {
                code: 'unique_evidence',
                label: 'Unique evidence in this corpus',
                impact: 'up',
              },
        );
        if (contextScore >= 0.5) {
          reasons.push({
            code: 'context',
            label: 'Substantial surrounding context',
            impact: 'up',
          });
        }
        reasons.push({
          code: 'severity_separate',
          label: `${finding.severity.toLowerCase()} detector severity (not importance)`,
          impact: 'neutral',
        });

        await this.prisma.findingEvidenceAnalysis.upsert({
          where: { findingId: finding.id },
          create: {
            findingId: finding.id,
            spaceId,
            importanceScore,
            qualityScore,
            similarCount,
            duplicateGroupHash: similarCount ? hash : null,
            reasons,
            signals: {
              contextScore,
              noveltyScore,
              detectorConfidence: Number(finding.confidence),
              ...(similarCount > 0 ? { duplicateSimilarity: 1 } : {}),
            },
          },
          update: {
            spaceId,
            importanceScore,
            qualityScore,
            similarCount,
            duplicateGroupHash: similarCount ? hash : null,
            reasons,
            signals: {
              contextScore,
              noveltyScore,
              detectorConfidence: Number(finding.confidence),
              ...(similarCount > 0 ? { duplicateSimilarity: 1 } : {}),
            },
            analyzedAt: new Date(),
          },
        });
      }),
    );
  }
}
