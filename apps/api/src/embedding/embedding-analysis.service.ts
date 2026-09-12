import { Injectable } from '@nestjs/common';
import { Severity } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { reasonsForStorage, type StoredReason } from './reason-labels';

type ValueRecurrenceRow = {
  normalizedValue: string;
  assetCount: bigint | number;
  sourceCount: bigint | number;
};

export type ValueRecurrence = Map<string, { assets: number; sources: number }>;

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
/** Findings analysed per page; the set for a hash list is corpus-sized. */
const ANALYZE_PAGE_SIZE = 2000;
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

/**
 * Three decimals, matching the precision `importanceScore` is stored at.
 *
 * Applied to the derived signals so the payload is stable against changes too
 * small to mean anything: `noveltyScore` is `1/sqrt(similarCount + 1)`, so on a
 * 56,000-member cohort one more member moves it by ~1e-8. At full float
 * precision that is a different value every scan, and every one of them was a
 * row rewrite.
 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * JSON with keys in a fixed order, for comparing a computed object against one
 * read back from JSONB.
 *
 * Postgres normalises JSONB key order (shortest first, then bytewise), so a
 * plain `JSON.stringify` of the two disagrees on ordering alone and every row
 * reads as changed.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The group hash to write, given what is already stored.
 *
 * Two phases write this column and they mean different things by it. Analysis
 * knows about EXACT duplicates and writes the finding's own content hash;
 * `calibrateNeighborhood` knows about near-duplicate components and writes the
 * component's root hash, which is a wider and different value.
 *
 * Both used to write unconditionally, so for every finding in a multi-hash
 * component the two took turns: analysis wrote the own hash, `analysisChanged`
 * saw the mismatch on the next pass and did a full rewrite — upsert, trigger,
 * cascading `findings` UPDATE — calibration flipped it back, forever. 130,489
 * analyses on one namespace, 21.6% of the table, stood diverged, so the no-op
 * optimisation could not converge for any of them and the value a client read
 * depended on which phase happened to run last.
 *
 * Analysis therefore seeds the group and may clear a value it owns, but never
 * overwrites a component root it has no way of computing. That converges: once
 * calibration has claimed a row, analysis reproduces what is stored and the
 * comparison reads equal.
 */
function groupHashFor(
  storedGroupHash: string | null | undefined,
  ownHash: string,
  similarCount: number,
): string | null {
  // A stored value that is neither absent nor this finding's own hash can only
  // have come from calibration.
  if (storedGroupHash != null && storedGroupHash !== ownHash) {
    return storedGroupHash;
  }
  return similarCount ? ownHash : null;
}

/** The stored columns an analysis write would touch, for the no-op check. */
type ComparableAnalysis = {
  spaceId: string;
  importanceScore: number;
  qualityScore: number;
  similarCount: number;
  duplicateGroupHash: string | null;
  reasons: unknown;
  signals: unknown;
};

/**
 * Whether re-analysing this finding actually produced anything new.
 *
 * A legacy row always reads as changed, because its reasons carry the finished
 * sentences rather than codes — which is wanted: the rewrite compacts it.
 */
function analysisChanged(
  stored: ComparableAnalysis,
  computed: ComparableAnalysis,
): boolean {
  return (
    stored.spaceId !== computed.spaceId ||
    stored.importanceScore !== computed.importanceScore ||
    stored.qualityScore !== computed.qualityScore ||
    stored.similarCount !== computed.similarCount ||
    stored.duplicateGroupHash !== computed.duplicateGroupHash ||
    canonical(stored.reasons) !== canonical(computed.reasons) ||
    canonical(stored.signals) !== canonical(computed.signals)
  );
}

@Injectable()
export class EmbeddingAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeValue(value: string): string {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private async valueRecurrence(values: string[]): Promise<ValueRecurrence> {
    const unique = [
      ...new Set(
        values.filter((value) => value.length >= MIN_RECURRENCE_VALUE_LENGTH),
      ),
    ];
    if (!unique.length) return new Map();
    const rows = await this.prisma.$queryRaw<ValueRecurrenceRow[]>`
      SELECT lower(btrim(regexp_replace(matched_content, '\\s+', ' ', 'g'))) AS "normalizedValue",
        count(DISTINCT asset_id) AS "assetCount",
        count(DISTINCT source_id) AS "sourceCount"
      FROM findings
      WHERE lower(btrim(regexp_replace(matched_content, '\\s+', ' ', 'g'))) = ANY(${unique}::text[])
      GROUP BY 1
    `;
    return new Map(
      rows.map((row) => [
        row.normalizedValue,
        { assets: Number(row.assetCount), sources: Number(row.sourceCount) },
      ]),
    );
  }

  /**
   * Compute corpus-wide recurrence once for a full recalibration. Passing this
   * snapshot into every analysis batch avoids rescanning the findings table
   * once per 500 rows.
   */
  async valueRecurrenceSnapshot(): Promise<ValueRecurrence> {
    const rows = await this.prisma.$queryRaw<ValueRecurrenceRow[]>`
      SELECT lower(btrim(regexp_replace(matched_content, '\\s+', ' ', 'g'))) AS "normalizedValue",
        count(DISTINCT asset_id) AS "assetCount",
        count(DISTINCT source_id) AS "sourceCount"
      FROM findings
      WHERE length(lower(btrim(regexp_replace(matched_content, '\\s+', ' ', 'g')))) >= ${MIN_RECURRENCE_VALUE_LENGTH}
      GROUP BY 1
      HAVING count(DISTINCT asset_id) >= 2
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

  /**
   * Score every finding sharing one of these content hashes.
   *
   * Returns how many findings were visited, and stops early once `maxRows` is
   * reached. The count is what the caller budgets on: a hash list derived from
   * 500 findings expands to every member of their cohorts, and one register-wide
   * tag hash is 56,405 findings — so "500 findings" is not a bound on anything.
   *
   * Stopping mid-cohort leaves the remainder with a stale `analyzedAt`, which
   * is exactly what the refresh phase orders by, so the next pass picks them up
   * first. It does re-walk the part already done, but those rows now compare
   * equal and cost one HOT update each.
   */
  async analyzeHashes(
    spaceId: string,
    contentHashes: string[],
    recurrenceSnapshot?: ValueRecurrence,
    maxRows = Number.POSITIVE_INFINITY,
  ): Promise<number> {
    if (!contentHashes.length || maxRows <= 0) return 0;

    // Occurrence counts come from a GROUP BY, not from counting rows here.
    //
    // The caller passes hashes derived from a batch of findings, but a hash is
    // shared by many findings — 391 on average on the corpus this was measured
    // against — so `findMany` over those hashes returned ~125,000 rows for a
    // 500-finding batch, each carrying matched_content and both context
    // windows. That read was the most frequent query in flight whenever the
    // API's heap was climbing towards the 2 GB ceiling it died at.
    //
    // Counting in SQL and then walking the findings in pages keeps the peak
    // flat. Every finding is still analyzed, with the same counts: the
    // occurrence total is over all findings sharing the hash either way.
    const countRows = await this.prisma.finding.groupBy({
      by: ['embedContentHash'],
      where: { embedContentHash: { in: contentHashes } },
      _count: { _all: true },
    });
    const counts = new Map<string, number>(
      countRows
        .filter((row) => row.embedContentHash)
        .map((row) => [row.embedContentHash as string, row._count._all]),
    );

    // Computed once, before the walk. Doing it per page would re-run an
    // aggregate over the findings table for every page — the walk exists to
    // bound memory, not to multiply queries.
    const recurrence =
      recurrenceSnapshot ??
      (await this.valueRecurrenceForHashes(contentHashes));

    let visited = 0;
    for await (const page of this.findingPages(contentHashes)) {
      const findings = page.slice(0, maxRows - visited);
      visited += findings.length;
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
          // A value carried by a handful of assets is the strongest evidential
          // signal here — the same company number across several filings is
          // exactly what an investigator is looking for.
          //
          // This used to require `similarCount === 0`. That was deliberate, not
          // an oversight: docs/first-use/ranking-calibration-2026-07-16.md added
          // this bonus precisely because recurrence went unrewarded, and scoped
          // it to values appearing "in different contexts" — "same-context
          // repeats are template copies and stay penalized" — implemented as
          // that test. It holds for prose and fails for structured extraction,
          // where a shared field has identical context BY CONSTRUCTION: every
          // asset's company-number field looks the same because the context
          // window IS the field. So the fix for "recurrence unrewarded"
          // reintroduced it for exactly the corpus shape it matters most in. The
          // effect on the Firmenbuch corpus was that 147,823 analyses were
          // denied the reason, 90,570 of them `regex:AT_FIRMENBUCHNUMMER`
          // averaging 4.8 assets — so 6.0% of narrow-group findings cleared the
          // 0.75 express/unmonitored threshold against 99.2% of ungrouped ones,
          // and autopilot could not see the cross-reference at all.
          const crossDocumentRecurrence =
            !testValue &&
            !repeatedDigits &&
            crossAssetCount >= 2 &&
            crossAssetCount <= RECURRENCE_HUB_CAP;
          // The BONUS keeps the old gate, deliberately. Awarding it to the
          // wider set moves 67,621 findings over 0.75 (66,647 of them company
          // numbers), which re-tunes what the express lane and the
          // unmonitored-evidence signal fire on. That is a separate, measured
          // decision; this change moves no score. See STORAGE_RECLAIM.md.
          const crossDocumentLead =
            crossDocumentRecurrence && similarCount === 0;
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
          // Codes and their parameters only; the sentence and the impact are
          // rendered on read. See reason-labels.ts.
          const reasons: StoredReason[] = [];
          reasons.push(
            qualityScore < 0.45
              ? { c: 'ocr_fragment' }
              : { c: 'readable_context' },
          );
          reasons.push(
            similarCount > 0
              ? { c: 'duplicate_group', n: similarCount }
              : { c: 'unique_evidence' },
          );
          if (contextScore >= 0.5) {
            reasons.push({ c: 'context' });
          }
          if (crossDocumentRecurrence) {
            reasons.push({
              c: 'cross_document_recurrence',
              n: crossAssetCount,
              n2: crossSourceCount,
            });
          }
          if (commonValue) {
            reasons.push({ c: 'common_value', n: crossAssetCount });
          }
          if (testValue) {
            reasons.push({ c: 'known_test_value' });
          }
          if (repeatedDigits) {
            reasons.push({ c: 'repeated_digit_pattern' });
          }
          reasons.push({
            c: 'severity_separate',
            s: finding.severity.toLowerCase(),
          });

          // One payload, used for the write AND for the comparison below, so
          // the two cannot drift. It used to be spelled out twice.
          const stored = finding.evidenceAnalysis;
          const computed = {
            spaceId,
            importanceScore,
            qualityScore,
            similarCount,
            duplicateGroupHash: groupHashFor(
              stored?.duplicateGroupHash,
              hash,
              similarCount,
            ),
            reasons,
            signals: {
              contextScore: round3(contextScore),
              noveltyScore: round3(noveltyScore),
              detectorConfidence: Number(finding.confidence),
              crossAssetCount,
              crossSourceCount,
              valueLength: normalizedValue.length,
              ...(similarCount > 0 ? { duplicateSimilarity: 1 } : {}),
            },
          };

          if (stored && !analysisChanged(stored, computed)) {
            // Nothing moved, so do not rewrite the row. This is most of the
            // work on a mature corpus: a cohort member whose `similarCount`
            // goes 56,404 -> 56,405 has an `importanceScore` identical to three
            // decimals, and used to take a full row rewrite plus a
            // `trg_sync_finding_importance_score` firing plus the cascading
            // single-row UPDATE on `findings` that the trigger performs. The
            // lifetime counters on one namespace read 7,372,783 updates against
            // 604,235 rows.
            //
            // `analyzedAt` still has to move. Recalibration's refresh phase
            // orders by it and relies on a processed row leaving the set its
            // query selects from; skipping the write entirely would pin the
            // pass to the same prefix forever. Setting it alone is cheap in the
            // way the full rewrite is not — it touches neither index, so the
            // update stays HOT-eligible, and because the trigger is declared
            // `UPDATE OF importance_score`, leaving that column out of the SET
            // list means it does not fire.
            await this.prisma.findingEvidenceAnalysis.update({
              where: { findingId: finding.id },
              data: { analyzedAt: new Date() },
              select: { findingId: true },
            });
            return;
          }

          await this.prisma.findingEvidenceAnalysis.upsert({
            where: { findingId: finding.id },
            create: {
              findingId: finding.id,
              ...computed,
              reasons: reasonsForStorage(reasons),
            },
            update: {
              ...computed,
              reasons: reasonsForStorage(reasons),
              analyzedAt: new Date(),
            },
          });
        }),
      );
      if (visited >= maxRows) break;
    }
    return visited;
  }

  /**
   * Recurrence for exactly the values carried by these hashes, in one query.
   *
   * Equivalent to collecting every matched value for the hashes and asking
   * valueRecurrence about them, without materialising the findings to do it.
   */
  private async valueRecurrenceForHashes(
    contentHashes: string[],
  ): Promise<ValueRecurrence> {
    const rows = await this.prisma.$queryRaw<ValueRecurrenceRow[]>`
      SELECT "normalizedValue",
             count(DISTINCT asset_id) AS "assetCount",
             count(DISTINCT source_id) AS "sourceCount"
      FROM (
        SELECT lower(btrim(regexp_replace(matched_content, '\s+', ' ', 'g'))) AS "normalizedValue",
               asset_id, source_id
        FROM findings
        WHERE embed_content_hash = ANY(${contentHashes}::text[])
      ) scoped
      WHERE length("normalizedValue") >= ${MIN_RECURRENCE_VALUE_LENGTH}
      GROUP BY 1
    `;
    return new Map(
      rows.map((row) => [
        row.normalizedValue,
        { assets: Number(row.assetCount), sources: Number(row.sourceCount) },
      ]),
    );
  }

  /**
   * Findings for a set of content hashes, in bounded pages.
   *
   * The page size is the bound that matters: the *number* of findings sharing
   * these hashes is a property of the corpus, not of what the caller asked
   * for, and on a real one it is hundreds of times larger.
   */
  private async *findingPages(contentHashes: string[]) {
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.finding.findMany({
        where: { embedContentHash: { in: contentHashes } },
        select: {
          id: true,
          embedContentHash: true,
          severity: true,
          confidence: true,
          matchedContent: true,
          contextBefore: true,
          contextAfter: true,
          // Read back so an unchanged analysis can be recognised and left
          // alone — see the write in `analyzeHashes`.
          evidenceAnalysis: {
            select: {
              spaceId: true,
              importanceScore: true,
              qualityScore: true,
              similarCount: true,
              duplicateGroupHash: true,
              reasons: true,
              signals: true,
            },
          },
        },
        orderBy: { id: 'asc' },
        take: ANALYZE_PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (!page.length) return;
      yield page;
      if (page.length < ANALYZE_PAGE_SIZE) return;
      cursor = page.at(-1)?.id;
    }
  }
}
