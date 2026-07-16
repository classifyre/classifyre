import { Injectable } from '@nestjs/common';
import { Severity } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type Reason = {
  code: string;
  label: string;
  impact: 'up' | 'down' | 'neutral';
};

type ValueRecurrenceRow = {
  normalizedValue: string;
  assetCount: bigint | number;
  sourceCount: bigint | number;
};

// Findings whose evidence text falls below this quality are treated as likely
// OCR noise: their importance is scaled down proportionally instead of only
// losing the 30% quality term, so junk lands near the bottom of the ranking.
const QUALITY_GATE = 0.45;
// A value shared by this many assets or more stops being a lead and becomes a
// common token (dates, boilerplate headers); mirrors the correlation fan-out cap.
const RECURRENCE_HUB_CAP = 25;
const RECURRENCE_BONUS = 0.12;
const COMMON_VALUE_PENALTY = 0.1;
const MIN_RECURRENCE_VALUE_LENGTH = 4;
const TEST_VALUE_PENALTY = 0.25;
const REPEATED_DIGIT_PENALTY = 0.2;

// Canonical payment-network test numbers (Visa/Mastercard/Amex/Discover/JCB/
// Diners documentation values). A CRITICAL recognizer hit on one of these is a
// fixture or template, never evidence.
const KNOWN_TEST_NUMBERS = new Set([
  '4111111111111111',
  '4012888888881881',
  '4222222222222',
  '4917610000000000',
  '5555555555554444',
  '5105105105105100',
  '2223003122003222',
  '378282246310005',
  '371449635398431',
  '378734493671000',
  '6011111111111117',
  '6011000990139424',
  '6011004829032453',
  '3530111333300000',
  '3566002020360505',
  '30569309025904',
  '38520000023237',
]);

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/** A long digit string dominated by one or two digits — OCR/repetition artifact. */
function isRepeatedDigitPattern(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length < 8) return false;
  return new Set(digits).size <= 2;
}

function isKnownTestValue(value: string): boolean {
  const digits = digitsOf(value);
  return digits.length >= 12 && KNOWN_TEST_NUMBERS.has(digits);
}

@Injectable()
export class EmbeddingAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeValue(value: string): string {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private async valueRecurrence(
    values: string[],
  ): Promise<Map<string, { assets: number; sources: number }>> {
    const unique = [
      ...new Set(
        values.filter((value) => value.length >= MIN_RECURRENCE_VALUE_LENGTH),
      ),
    ];
    if (!unique.length) return new Map();
    const rows = await this.prisma.$queryRaw<ValueRecurrenceRow[]>`
      SELECT lower(regexp_replace(matched_content, '\\s+', ' ', 'g')) AS "normalizedValue",
        count(DISTINCT asset_id) AS "assetCount",
        count(DISTINCT source_id) AS "sourceCount"
      FROM findings
      WHERE lower(regexp_replace(matched_content, '\\s+', ' ', 'g')) = ANY(${unique}::text[])
      GROUP BY 1
    `;
    return new Map(
      rows.map((row) => [
        row.normalizedValue,
        { assets: Number(row.assetCount), sources: Number(row.sourceCount) },
      ]),
    );
  }

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
    const recurrence = await this.valueRecurrence(
      findings.map((finding) => this.normalizeValue(finding.matchedContent)),
    );

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
        const normalizedValue = this.normalizeValue(finding.matchedContent);
        const valueSpread = recurrence.get(normalizedValue);
        const crossAssetCount = valueSpread?.assets ?? 0;
        const crossSourceCount = valueSpread?.sources ?? 0;
        const testValue = isKnownTestValue(finding.matchedContent);
        const repeatedDigits =
          !testValue && isRepeatedDigitPattern(finding.matchedContent);
        const crossDocumentLead =
          !testValue &&
          !repeatedDigits &&
          crossAssetCount >= 2 &&
          crossAssetCount <= RECURRENCE_HUB_CAP;
        const commonValue = crossAssetCount > RECURRENCE_HUB_CAP;
        let base =
          qualityScore * 0.3 +
          Number(finding.confidence) * 0.2 +
          noveltyScore * 0.25 +
          contextScore * 0.15 +
          this.severityWeight(finding.severity) * 0.1;
        // Below the gate, quality scales the whole score: an unreadable
        // fragment must not keep the novelty/severity/confidence points that
        // let OCR junk rank mid-table.
        if (qualityScore < QUALITY_GATE) {
          base *= qualityScore / QUALITY_GATE;
        }
        if (crossDocumentLead) base += RECURRENCE_BONUS;
        if (commonValue) base -= COMMON_VALUE_PENALTY;
        if (testValue) base -= TEST_VALUE_PENALTY;
        if (repeatedDigits) base -= REPEATED_DIGIT_PENALTY;
        const importanceScore =
          Math.round(Math.max(0, Math.min(1, base)) * 1000) / 1000;
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
        if (crossDocumentLead) {
          reasons.push({
            code: 'cross_document_recurrence',
            label: `Same value found in ${crossAssetCount} assets${
              crossSourceCount > 1 ? ` across ${crossSourceCount} sources` : ''
            }`,
            impact: 'up',
          });
        }
        if (commonValue) {
          reasons.push({
            code: 'common_value',
            label: `Common value shared by ${crossAssetCount} assets; not discriminating`,
            impact: 'down',
          });
        }
        if (testValue) {
          reasons.push({
            code: 'known_test_value',
            label: 'Matches a documented payment-network test number',
            impact: 'down',
          });
        }
        if (repeatedDigits) {
          reasons.push({
            code: 'repeated_digit_pattern',
            label: 'Digit string dominated by repeated digits; likely artifact',
            impact: 'down',
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
              crossAssetCount,
              crossSourceCount,
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
              crossAssetCount,
              crossSourceCount,
              ...(similarCount > 0 ? { duplicateSimilarity: 1 } : {}),
            },
            analyzedAt: new Date(),
          },
        });
      }),
    );
  }
}
