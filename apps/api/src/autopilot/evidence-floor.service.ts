import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { InquiryMatchingService } from '../matching/inquiry-matching.service';
import type { InquiryMatchers } from '../matching/inquiry-matcher';
import {
  INQUIRY_DUPLICATE_OVERLAP,
  MAX_DUPLICATE_CANDIDATES,
  MAX_DUPLICATE_PREVIEWS,
  MIN_INQUIRY_MATCHES,
  WEAK_EVIDENCE_REASON_CODES,
} from './autopilot.constants';
import type { InquiryMatcherProposal } from './autopilot.types';

/**
 * The evidence floor: what an agent must be able to point at before it may
 * create an inquiry or open a case.
 *
 * Every guardrail here used to be prose in the mission text, and the first real
 * run showed what prose is worth. Against a 151-source corpus of which 12 had
 * been scanned, the agent created:
 *
 *  - four inquiries matching *nothing at all* — "Grand Cayman offshore
 *    references", "Louise Kitchen correspondence", "Rangel person references" —
 *    whose own recorded rationales cite the Enron scandal rather than any
 *    finding ("Grand Cayman is a known offshore jurisdiction"). That is the
 *    model retrieving a story from pretraining and manufacturing monitors to
 *    fit it;
 *  - five separate "HTML email artifact noise" inquiries, one per mailbox, the
 *    fifth rationale reading "same pattern as 5 other sources" — it knew it was
 *    duplicating and did it anyway, instead of widening the first inquiry's
 *    sourceIds;
 *  - two cases scoped to a single mailbox with no hypothesis and no conclusion.
 *
 * Refusals throw. The dispatcher turns a thrown handler error into
 * `{outcome: 'FAILED', result: {error}}` which the model reads on its next
 * turn, so every message here is written to be actionable in-loop: what was
 * wrong, and which tool to reach for instead.
 */
@Injectable()
export class EvidenceFloorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: InquiryMatchingService,
  ) {}

  /**
   * Gate `inquiries.create`. Runs three checks in increasing cost order:
   * does the matcher select anything, is what it selects provably noise, and
   * does an active inquiry already cover it.
   */
  async assertInquiryIsWarranted(
    proposal: InquiryMatcherProposal,
  ): Promise<void> {
    const matchers = toMatchers(proposal);
    const probe = await this.matching.probeMatches(matchers);

    if (probe.findingIds.length < MIN_INQUIRY_MATCHES) {
      // Distinguish "matches nothing" from "matched nothing in the window we
      // were willing to scan". Reporting a bounded miss as a definitive zero
      // would be a lie the agent cannot check.
      throw new Error(
        probe.exhausted
          ? `Refused: this matcher selects 0 open findings. An inquiry is a saved ` +
              `monitor over evidence that exists, not a hypothesis — a title you expect ` +
              `to become true is not an inquiry. Either narrow to findings you can see ` +
              `in findings.search / findings.ranked, or record the idea with ` +
              `memory.write and let a later cycle create the inquiry once evidence ` +
              `appears.`
          : `Refused: no match in the first ${probe.scanned} findings scanned, so this ` +
              `matcher is at best extremely sparse. Narrow it using ids from ` +
              `findings.search / findings.ranked rather than guessing at a pattern.`,
      );
    }

    const verdict = await this.assessFindings(probe.findingIds);
    if (verdict.provablyWeak) {
      throw new Error(
        `Refused: every one of the ${verdict.analyzed} scored findings this matcher ` +
          `selects is noise (${verdict.weakCodes.join(', ')}). An inquiry over a ` +
          `boilerplate cluster generates work without evidence. Use ` +
          `findings.boilerplate to confirm, then either target the specific ` +
          `high-importance findings from findings.ranked or leave it alone.`,
      );
    }

    const duplicate = await this.findDuplicateInquiry(
      matchers,
      // Only a fully-enumerated proposal can be tested for containment: a
      // bounded sample of a large set may miss an overlap that exists, and a
      // false "duplicate" refusal is worse than a missed one. When the cap was
      // hit, structural matcher similarity carries the check on its own.
      probe.exhausted ? probe.findingIds : [],
    );
    if (duplicate) {
      throw new Error(
        `Refused: inquiry ${duplicate.id} "${duplicate.title}" already covers ` +
          `${Math.round(duplicate.overlap * 100)}% of these findings. Widen it with ` +
          `inquiries.enrich (add this source to its sourceIds, or set matchAllSources) ` +
          `instead of creating a second inquiry for the same phenomenon — one monitor ` +
          `spanning every affected source is what an operator can act on; six ` +
          `near-identical ones are not.`,
      );
    }
  }

  /**
   * Gate `cases.create`. A case is an investigation, so it must start from
   * something already observed: an inquiry that is actually matching, or
   * findings that exist and are not all noise.
   */
  async assertCaseIsWarranted(input: {
    inquiryIds?: string[];
    findingIds?: string[];
  }): Promise<void> {
    const inquiryIds = input.inquiryIds ?? [];
    const findingIds = input.findingIds ?? [];

    if (inquiryIds.length === 0 && findingIds.length === 0) {
      throw new Error(
        `Refused: a case needs evidence to be a case. Pass inquiryIds for an inquiry ` +
          `that is matching, or findingIds you verified this cycle. If you only have a ` +
          `hunch about a source, add a hypothesis to an existing case or record it with ` +
          `memory.write — "investigate this mailbox" is not an investigation.`,
      );
    }

    if (inquiryIds.length > 0) {
      const matching = await this.prisma.inquiry.findMany({
        where: { id: { in: inquiryIds }, matchCount: { gt: 0 } },
        select: { id: true },
      });
      if (matching.length > 0) return;
    }

    if (findingIds.length > 0) {
      const verdict = await this.assessFindings(findingIds);
      if (verdict.known === 0) {
        throw new Error(
          `Refused: none of the findingIds you cited exist. Cite ids returned by ` +
            `findings.search or findings.ranked in this run — do not construct them.`,
        );
      }
      if (verdict.provablyWeak) {
        throw new Error(
          `Refused: every scored finding you cited is noise ` +
            `(${verdict.weakCodes.join(', ')}). Severity is not importance. Call ` +
            `findings.explain on the findings you intend to build on and pick ones ` +
            `whose reasons include cross_document_recurrence or unique_evidence.`,
        );
      }
      return;
    }

    throw new Error(
      `Refused: the inquiries you linked have no matches yet, so there is nothing to ` +
        `investigate. Wait for them to match, or cite findingIds directly.`,
    );
  }

  /**
   * Classify a set of finding ids by what the evidence analyzer says about them.
   *
   * `provablyWeak` is deliberately narrow: it requires that findings were
   * scored AND that every scored one is weak. A finding with no analysis row
   * has `importanceScore` 0 for the same reason a pending one does, so treating
   * unscored as weak would let a lagging embedding queue silently block every
   * legitimate inquiry. Unscored is pending, not unimportant.
   */
  async assessFindings(findingIds: string[]): Promise<{
    known: number;
    analyzed: number;
    strong: number;
    provablyWeak: boolean;
    weakCodes: string[];
  }> {
    if (findingIds.length === 0) {
      return {
        known: 0,
        analyzed: 0,
        strong: 0,
        provablyWeak: false,
        weakCodes: [],
      };
    }
    const rows = await this.prisma.finding.findMany({
      where: { id: { in: findingIds } },
      select: { id: true, evidenceAnalysis: { select: { reasons: true } } },
    });

    const weakCodes = new Set<string>();
    let analyzed = 0;
    let strong = 0;
    for (const row of rows) {
      const reasons = row.evidenceAnalysis?.reasons;
      if (reasons == null) continue;
      analyzed++;
      const codes = reasonCodes(reasons);
      // Read strength from the analyzer's own `impact`, not from a hard-coded
      // code list: the reason vocabulary grows, and a floor that silently stops
      // recognising a new positive signal fails in the expensive direction.
      const hasUpside = hasPositiveImpact(reasons);
      if (hasUpside) strong++;
      else codes.filter(isWeakCode).forEach((c) => weakCodes.add(c));
    }

    return {
      known: rows.length,
      analyzed,
      strong,
      provablyWeak: analyzed > 0 && strong === 0 && analyzed === rows.length,
      weakCodes: [...weakCodes],
    };
  }

  /**
   * The active inquiry, if any, that is already the monitor being proposed.
   *
   * Two tests, because the real duplicates fail the obvious one. The first run
   * produced six "HTML email artifact noise" inquiries — symes-k, zufferli-j,
   * hernandez-j, king-j, smith-m, stokley-c — each scoped to ONE mailbox with
   * `matchAllSources: false`. Their selected finding sets are therefore
   * disjoint: comparing what they match scores zero overlap and waves all six
   * through. What makes them one monitor is that their matchers are the same
   * once you ignore which source they point at (identical detectorTypes {PII},
   * identical findingTypes, largely identical value regexes).
   *
   * So: compare the matchers source-blind first — free, and precisely targets
   * the per-source clone family — then fall back to comparing what the
   * matchers actually select, which catches two differently-phrased matchers
   * that happen to cover the same findings.
   */
  private async findDuplicateInquiry(
    matchers: InquiryMatchers,
    proposedIds: string[],
  ): Promise<{ id: string; title: string; overlap: number } | null> {
    const candidates = await this.prisma.inquiry.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      take: MAX_DUPLICATE_CANDIDATES,
      select: {
        id: true,
        title: true,
        matchAllSources: true,
        sourceIds: true,
        detectorTypes: true,
        customDetectorKeys: true,
        findingTypes: true,
        findingTypeRegex: true,
        findingValueRegex: true,
      },
    });

    const scored = candidates
      .map((c) => ({
        candidate: c,
        similarity: matcherSimilarity(matchers, c),
      }))
      .sort((a, b) => b.similarity - a.similarity);

    for (const { candidate, similarity } of scored) {
      if (similarity >= INQUIRY_DUPLICATE_OVERLAP) {
        return {
          id: candidate.id,
          title: candidate.title,
          overlap: similarity,
        };
      }
    }

    if (proposedIds.length === 0) return null;
    const proposed = new Set(proposedIds);

    // Only the most structurally similar handful are worth a query; a preview
    // walks every matching finding, and this runs inside a tool call. The cap
    // is the cost control — a zero structural score is NOT a reason to skip,
    // since two matchers phrased entirely differently can still select the
    // same findings, which is precisely what this second check is for.
    for (const { candidate } of scored.slice(0, MAX_DUPLICATE_PREVIEWS)) {
      const { findingIds } = await this.matching.probeMatches({
        matchAllSources: candidate.matchAllSources,
        sourceIds: candidate.sourceIds,
        detectorTypes: candidate.detectorTypes,
        customDetectorKeys: candidate.customDetectorKeys,
        findingTypes: candidate.findingTypes,
        findingTypeRegex: candidate.findingTypeRegex,
        findingValueRegex: candidate.findingValueRegex,
      });
      const existing = new Set(findingIds);
      if (existing.size === 0) continue;

      // Containment, not Jaccard: a per-source proposal whose findings all sit
      // inside a corpus-wide inquiry is a duplicate even though the
      // corpus-wide one is far larger.
      let shared = 0;
      for (const id of proposed) if (existing.has(id)) shared++;
      const overlap = shared / proposed.size;
      if (overlap >= INQUIRY_DUPLICATE_OVERLAP) {
        return { id: candidate.id, title: candidate.title, overlap };
      }
    }
    return null;
  }
}

/**
 * How alike two matchers are once source scoping is ignored — the mean of the
 * per-dimension Jaccard scores over the dimensions either side actually uses.
 *
 * Source scoping is excluded deliberately: "the same monitor pointed at a
 * different mailbox" is the duplicate this is here to catch, so differing
 * `sourceIds` must not reduce the score. Dimensions both sides leave empty are
 * skipped rather than counted as agreement, or two inquiries sharing nothing
 * but their emptiness would score 1.
 */
export function matcherSimilarity(
  a: InquiryMatchers,
  b: Pick<
    InquiryMatchers,
    | 'detectorTypes'
    | 'customDetectorKeys'
    | 'findingTypes'
    | 'findingTypeRegex'
    | 'findingValueRegex'
  >,
): number {
  // The dimensions that say WHAT is being watched, as opposed to which broad
  // family it belongs to. When both matchers name specifics and share none of
  // them, they are watching different things however much of the coarse
  // classification they have in common — and without this veto they routinely
  // do: "Arora-Arnold trading correspondence" and "Louise Kitchen
  // correspondence" are both PII/{EMAIL_ADDRESS,PERSON}, agreeing on two of
  // three dimensions and scoring 0.67, while their value regexes (arnold|arora
  // vs kitchen) show they are about different people entirely.
  const discriminating: Array<[string[], string[]]> = [
    [a.customDetectorKeys, b.customDetectorKeys],
    [a.findingTypeRegex, b.findingTypeRegex],
    [a.findingValueRegex, b.findingValueRegex],
  ];
  const bothConstrain = discriminating.some(
    ([xs, ys]) => xs.length > 0 && ys.length > 0,
  );
  if (bothConstrain) {
    const sharesSpecifics = discriminating.some(([xs, ys]) =>
      xs.some((x) => ys.includes(x)),
    );
    if (!sharesSpecifics) return 0;
  }

  const dimensions: Array<[string[], string[]]> = [
    [a.detectorTypes, b.detectorTypes],
    [a.findingTypes, b.findingTypes],
    ...discriminating,
  ];

  const scores: number[] = [];
  for (const [xs, ys] of dimensions) {
    if (xs.length === 0 && ys.length === 0) continue;
    scores.push(jaccard(xs, ys));
  }
  // Nothing but source scoping distinguishes them, and neither constrains
  // anything: too unspecific to call a duplicate on.
  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

function jaccard(xs: string[], ys: string[]): number {
  const a = new Set(xs);
  const b = new Set(ys);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

function toMatchers(proposal: InquiryMatcherProposal): InquiryMatchers {
  return {
    matchAllSources: proposal.matchAllSources ?? false,
    sourceIds: proposal.sourceIds ?? [],
    detectorTypes: proposal.detectorTypes ?? [],
    customDetectorKeys: proposal.customDetectorKeys ?? [],
    findingTypes: proposal.findingTypes ?? [],
    findingTypeRegex: proposal.findingTypeRegex ?? [],
    findingValueRegex: proposal.findingValueRegex ?? [],
  };
}

interface ReasonRow {
  code?: unknown;
  impact?: unknown;
}

function asReasonRows(reasons: unknown): ReasonRow[] {
  return Array.isArray(reasons) ? (reasons as ReasonRow[]) : [];
}

function reasonCodes(reasons: unknown): string[] {
  return asReasonRows(reasons)
    .map((r) => (typeof r.code === 'string' ? r.code : null))
    .filter((c): c is string => c !== null);
}

function hasPositiveImpact(reasons: unknown): boolean {
  return asReasonRows(reasons).some((r) => r.impact === 'up');
}

function isWeakCode(code: string): boolean {
  return (WEAK_EVIDENCE_REASON_CODES as readonly string[]).includes(code);
}
