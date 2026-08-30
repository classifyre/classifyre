import { DetectorType, Prisma } from '@prisma/client';

/** A question's matcher configuration (which findings the query selects). */
export interface InquiryMatchers {
  matchAllSources: boolean;
  sourceIds: string[];
  detectorTypes: DetectorType[];
  customDetectorKeys: string[];
  findingTypes: string[];
  findingTypeRegex: string[];
  /** Regex patterns matched against the finding's matchedContent value. Empty = any. */
  findingValueRegex: string[];
}

/** The minimal finding shape needed to decide a match. */
export interface FindingCandidate {
  sourceId: string;
  detectorType: DetectorType;
  findingType: string;
  customDetectorKey?: string | null;
  matchedContent?: string | null;
}

/**
 * Precompiled matcher for a single question. Regexes are compiled once; invalid
 * patterns are skipped defensively (validated on save, but never trust input).
 *
 * A finding matches iff ALL non-empty dimensions match:
 *   source AND detector AND type (exact OR typeRegex) AND valueRegex
 * Empty list for a dimension means "any". The detector dimension is satisfied by
 * either a built-in detectorType or a customDetectorKey -- except that naming
 * custom keys narrows CUSTOM findings rather than widening them: see matches().
 */
export class CompiledMatcher {
  private readonly matchAllSources: boolean;
  private readonly sourceIds: Set<string>;
  private readonly detectorTypes: Set<string>;
  private readonly customDetectorKeys: Set<string>;
  private readonly findingTypes: Set<string>;
  private readonly typeRegexes: RegExp[];
  private readonly valueRegexes: RegExp[];

  constructor(m: InquiryMatchers) {
    this.matchAllSources = m.matchAllSources;
    this.sourceIds = new Set(m.sourceIds);
    this.detectorTypes = new Set<string>(m.detectorTypes);
    this.customDetectorKeys = new Set(m.customDetectorKeys);
    this.findingTypes = new Set(m.findingTypes);
    this.typeRegexes = compilePatterns(m.findingTypeRegex);
    this.valueRegexes = compilePatterns(m.findingValueRegex);
  }

  matches(f: FindingCandidate): boolean {
    // 1. Source
    if (!this.matchAllSources && !this.sourceIds.has(f.sourceId)) return false;

    // 2. Detector (built-in type OR custom key)
    const hasDetectorFilter =
      this.detectorTypes.size > 0 || this.customDetectorKeys.size > 0;
    if (hasDetectorFilter) {
      // CUSTOM is the supertype of every custom key, so a plain OR between the
      // two made `detectorTypes: ['CUSTOM']` swallow the key list entirely: the
      // type matched first and every custom finding in the namespace came back.
      // A question asking for one tag key got all of them, silently, with no
      // error to notice. When keys are named they therefore *restrict* CUSTOM
      // findings; other detector types are unaffected and still match by type.
      const keyFilterApplies =
        this.customDetectorKeys.size > 0 && f.detectorType === 'CUSTOM';
      const detectorOk = keyFilterApplies
        ? f.customDetectorKey != null &&
          this.customDetectorKeys.has(f.customDetectorKey)
        : this.detectorTypes.has(f.detectorType) ||
          (f.customDetectorKey != null &&
            this.customDetectorKeys.has(f.customDetectorKey));
      if (!detectorOk) return false;
    }

    // 3. Finding type (exact match OR typeRegex; empty = any)
    const noTypeFilter =
      this.findingTypes.size === 0 && this.typeRegexes.length === 0;
    if (!noTypeFilter) {
      const typeOk =
        this.findingTypes.has(f.findingType) ||
        this.typeRegexes.some((re) => re.test(f.findingType));
      if (!typeOk) return false;
    }

    // 4. Matched-content value regex (all must pass at least one; empty = any)
    if (this.valueRegexes.length > 0) {
      const content = f.matchedContent ?? '';
      if (!this.valueRegexes.some((re) => re.test(content))) return false;
    }

    return true;
  }
}

/**
 * The SQL half of the same matcher: source, detector and (when safe) exact type.
 *
 * Deliberately in THIS file, next to {@link CompiledMatcher.matches}, and not
 * in the service that calls it. The two halves have to agree dimension for
 * dimension, the old code said so in a comment — and then drifted from its own
 * comment anyway, because the halves lived in different files and nobody read
 * them together. `inquiry-matcher.spec.ts` runs both over the same fixtures so
 * a future divergence fails a test rather than a customer's investigation.
 *
 * The stakes are higher than "coarse prefilter": when no regex dimension is
 * configured this `where` IS the answer — `previewRows` returns a COUNT(*) over
 * it and never consults the matcher — so a divergence returns a wrong *number*,
 * not merely a wide candidate set.
 */
export function candidateWhere(m: InquiryMatchers): Prisma.FindingWhereInput {
  const hasDetectorFilter =
    m.detectorTypes.length > 0 || m.customDetectorKeys.length > 0;
  const where: Prisma.FindingWhereInput = { status: 'OPEN' };
  if (!m.matchAllSources) where.sourceId = { in: m.sourceIds };
  if (hasDetectorFilter) {
    // Naming custom keys RESTRICTS custom findings rather than widening them:
    // CUSTOM is the supertype of every custom key, so a plain OR let
    // `detectorTypes: ['CUSTOM']` swallow the key list and match every custom
    // finding in the namespace. Mirrors the `keyFilterApplies` branch above.
    const nonCustomTypes = m.detectorTypes.filter(
      (t) => t !== DetectorType.CUSTOM,
    );
    const custom: Prisma.FindingWhereInput[] =
      m.customDetectorKeys.length > 0
        ? [{ customDetectorKey: { in: m.customDetectorKeys } }]
        : m.detectorTypes.includes(DetectorType.CUSTOM)
          ? [{ detectorType: DetectorType.CUSTOM }]
          : [];
    where.OR = [
      ...(nonCustomTypes.length > 0
        ? [{ detectorType: { in: nonCustomTypes } }]
        : []),
      ...custom,
    ];
  }
  // Exact-type SQL prefilter: only safe when there are no type-regexes AND no
  // value-regexes, because either can match a type this list does not name.
  if (
    m.findingTypeRegex.length === 0 &&
    m.findingValueRegex.length === 0 &&
    m.findingTypes.length > 0
  ) {
    where.findingType = { in: m.findingTypes };
  }
  return where;
}

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.flatMap((p) => {
    try {
      return [new RegExp(p)];
    } catch {
      return [];
    }
  });
}
