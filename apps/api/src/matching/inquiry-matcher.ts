import { DetectorType } from '@prisma/client';

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
 * either a built-in detectorType or a customDetectorKey.
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
    const hasDetectorFilter = this.detectorTypes.size > 0 || this.customDetectorKeys.size > 0;
    if (hasDetectorFilter) {
      const detectorOk =
        this.detectorTypes.has(f.detectorType) ||
        (f.customDetectorKey != null && this.customDetectorKeys.has(f.customDetectorKey));
      if (!detectorOk) return false;
    }

    // 3. Finding type (exact match OR typeRegex; empty = any)
    const noTypeFilter = this.findingTypes.size === 0 && this.typeRegexes.length === 0;
    if (!noTypeFilter) {
      const typeOk = this.findingTypes.has(f.findingType) || this.typeRegexes.some((re) => re.test(f.findingType));
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

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.flatMap((p) => {
    try {
      return [new RegExp(p)];
    } catch {
      return [];
    }
  });
}
