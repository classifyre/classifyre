import { AUTO_RETIREMENT_REASONS } from '../types/finding-history';

/**
 * The pure half of automatic case clean-up: which finding or asset a case's
 * rules and filters take out, decided from rows the caller already holds.
 * No database, no Nest — CaseCleanupService reads the rows and applies what
 * these functions decide, and the specs run them over plain fixtures.
 */

/** A case's clean-up switches (all off by default). */
export interface CleanupRules {
  /** Findings the scans no longer see: retired by a run, or the row deleted. */
  removeGoneFindings: boolean;
  /** Findings someone resolved. */
  removeResolvedFindings: boolean;
  /** Assets deleted from their source, with their findings. */
  removeGoneAssets: boolean;
}

export const CLEANUP_RULE_KEYS = [
  'removeGoneFindings',
  'removeResolvedFindings',
  'removeGoneAssets',
] as const satisfies ReadonlyArray<keyof CleanupRules>;

export type CleanupRuleKey = (typeof CLEANUP_RULE_KEYS)[number];

export const NO_CLEANUP: CleanupRules = {
  removeGoneFindings: false,
  removeResolvedFindings: false,
  removeGoneAssets: false,
};

export function anyRule(rules: CleanupRules): boolean {
  return CLEANUP_RULE_KEYS.some((key) => rules[key]);
}

/** The rules switched on in `next` that were off in `previous`. */
export function newlyEnabled(
  previous: CleanupRules,
  next: CleanupRules,
): CleanupRules {
  return {
    removeGoneFindings: next.removeGoneFindings && !previous.removeGoneFindings,
    removeResolvedFindings:
      next.removeResolvedFindings && !previous.removeResolvedFindings,
    removeGoneAssets: next.removeGoneAssets && !previous.removeGoneAssets,
  };
}

/**
 * Why a finding or asset left a case by itself. One per rule, so one timeline
 * entry says which switch (or which filter) did it.
 */
export type FindingRemovalReason =
  | 'FINDING_GONE'
  | 'FINDING_RESOLVED'
  | 'FILTER';

/** What happened to a finding that is gone: retired by a scan, or deleted. */
export type GoneState = 'RETIRED' | 'DELETED';

/** A cited finding's live row, as far as clean-up is concerned. */
export interface LiveFindingState {
  status: string;
  resolutionReason: string | null;
}

/**
 * The rule that takes a cited finding out, if any. `live` is null when the
 * finding's row no longer exists.
 *
 * The platform's own retirement is told apart from a person's resolve by the
 * reason it writes (see {@link retiredBySystem}). FALSE_POSITIVE and IGNORED
 * are a person's verdict on a finding that still exists, and no rule touches
 * them.
 */
export function findingRemoval(
  live: LiveFindingState | null,
  rules: CleanupRules,
):
  | { reason: 'FINDING_GONE'; state: GoneState }
  | { reason: 'FINDING_RESOLVED' }
  | null {
  if (!live) {
    return rules.removeGoneFindings
      ? { reason: 'FINDING_GONE', state: 'DELETED' }
      : null;
  }
  if (live.status !== 'RESOLVED') return null;
  if (retiredBySystem(live.resolutionReason)) {
    return rules.removeGoneFindings
      ? { reason: 'FINDING_GONE', state: 'RETIRED' }
      : null;
  }
  return rules.removeResolvedFindings ? { reason: 'FINDING_RESOLVED' } : null;
}

/**
 * Whether a RESOLVED finding was retired by the platform rather than by a
 * person: a scan no longer saw it (or its asset or file), its detector was
 * removed, or a detector's scope change retired it (retire-out-of-scope writes
 * "Out of scope for <detector>: …"). None of those can come back by
 * themselves, which is what "gone" means to a case.
 */
export function retiredBySystem(reason: string | null): boolean {
  if (reason == null) return false;
  return (
    AUTO_RETIREMENT_REASONS.includes(reason) ||
    reason.startsWith(OUT_OF_SCOPE_PREFIX)
  );
}

/** How retire-out-of-scope begins every reason it writes. */
const OUT_OF_SCOPE_PREFIX = 'Out of scope for ';

/**
 * Whether an asset cited as evidence is gone from its source. `live` is null
 * when the asset row no longer exists (a purge, or its source was deleted).
 */
export function assetRemoval(
  live: { status: string } | null,
  rules: CleanupRules,
): GoneState | null {
  if (!rules.removeGoneAssets) return null;
  if (!live) return 'DELETED';
  return live.status === 'DELETED' ? 'RETIRED' : null;
}

// ─── Finding filters ──────────────────────────────────────────────────────────

export type FindingFilterKind = 'FINDING_TYPE' | 'VALUE_PATTERN';

/** Longest pattern a filter accepts — the same ceiling inquiry regexes have. */
export const FILTER_PATTERN_MAX = 500;

export interface FindingFilterRule {
  id: string;
  kind: FindingFilterKind;
  pattern: string;
  /** Null: case-wide. Otherwise the CaseInquiry link the filter belongs to. */
  caseInquiryId: string | null;
}

/** The two finding fields a filter reads. */
export interface FilterableFinding {
  findingType: string;
  matchedContent: string | null;
}

export interface CompiledFindingFilter {
  rule: FindingFilterRule;
  test(finding: FilterableFinding): boolean;
}

/**
 * Compile filters once per batch. A pattern that does not compile matches
 * nothing: they are validated on save, and a filter that silently matched
 * everything would empty the case.
 */
export function compileFindingFilters(
  rules: readonly FindingFilterRule[],
): CompiledFindingFilter[] {
  return rules.map((rule) => {
    if (rule.kind === 'FINDING_TYPE') {
      return {
        rule,
        test: (f: FilterableFinding) => f.findingType === rule.pattern,
      };
    }
    let re: RegExp | null = null;
    try {
      re = new RegExp(rule.pattern);
    } catch {
      re = null;
    }
    return {
      rule,
      test: (f: FilterableFinding) =>
        re !== null && re.test(f.matchedContent ?? ''),
    };
  });
}

/** The first filter that takes a finding out, or null. */
export function firstMatchingFilter(
  finding: FilterableFinding,
  filters: readonly CompiledFindingFilter[],
): CompiledFindingFilter | null {
  for (const filter of filters) if (filter.test(finding)) return filter;
  return null;
}

/** Why a filter pattern cannot be saved, or null when it can. */
export function filterPatternProblem(
  kind: FindingFilterKind,
  pattern: string,
): string | null {
  if (pattern.trim().length === 0) return 'The pattern is empty.';
  if (pattern.length > FILTER_PATTERN_MAX)
    return `The pattern is longer than ${FILTER_PATTERN_MAX} characters.`;
  if (kind === 'VALUE_PATTERN') {
    try {
      new RegExp(pattern);
    } catch (error) {
      return `Not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return null;
}
