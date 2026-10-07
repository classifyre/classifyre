import {
  compileFindingFilters,
  filterPatternProblem,
  type FilterableFinding,
  type FindingFilterKind,
} from './case-cleanup.rules';

/**
 * The pure half of hypothesis rules: which hypothesis, with which stance, an
 * arriving finding is linked to. Decided from rows the caller already holds —
 * no database, no Nest — so the specs run it over plain fixtures and
 * CaseHypothesisRulesService only reads the rows and writes what is decided.
 */

export type RuleStance = 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';

export const RULE_STANCES: readonly RuleStance[] = [
  'SUPPORTS',
  'CONTRADICTS',
  'NEUTRAL',
];

/** A hypothesis rule, as far as matching is concerned. */
export interface HypothesisRuleSpec {
  id: string;
  threadId: string;
  stance: RuleStance;
  /** Null together with `pattern`: every answer of the watch. */
  kind: FindingFilterKind | null;
  pattern: string | null;
  createdAt: Date;
}

/** An arriving finding, as the case holds it. */
export interface RuleFinding extends FilterableFinding {
  /** The case-finding id: what a stance link targets. */
  caseFindingId: string;
}

export interface PlannedLink {
  caseFindingId: string;
  threadId: string;
  stance: RuleStance;
  ruleId: string;
}

/** Why a rule's matcher cannot be saved, or null when it can. */
export function ruleMatcherProblem(
  kind: FindingFilterKind | null | undefined,
  pattern: string | null | undefined,
): string | null {
  const hasKind = kind != null;
  const hasPattern = pattern != null && pattern !== '';
  if (!hasKind && !hasPattern) return null;
  if (hasKind !== hasPattern) {
    return 'A rule that narrows its answers needs both a kind and a pattern.';
  }
  return filterPatternProblem(kind as FindingFilterKind, pattern as string);
}

/**
 * Which hypothesis each finding is linked to, and with what stance.
 *
 * A finding goes to every hypothesis a rule names, so one answer can support
 * one theory and contradict another. When two rules name the same hypothesis
 * for the same finding the narrower one wins (a rule that tests the finding
 * beats one that takes everything), and between equals the older rule — a
 * result that does not depend on the order rows come back in.
 *
 * `held` is the pairs (case finding, hypothesis) that already carry a link:
 * those are left alone, so a person's own stance is never overridden and a
 * second pass changes nothing.
 */
export function planLinks(
  rules: readonly HypothesisRuleSpec[],
  findings: readonly RuleFinding[],
  held: ReadonlySet<string> = new Set(),
): PlannedLink[] {
  if (rules.length === 0 || findings.length === 0) return [];
  const ordered = [...rules].sort((a, b) => {
    const narrow = Number(b.kind != null) - Number(a.kind != null);
    if (narrow !== 0) return narrow;
    const age = a.createdAt.getTime() - b.createdAt.getTime();
    return age !== 0 ? age : a.id.localeCompare(b.id);
  });
  const compiled = ordered.map((rule) => {
    if (rule.kind == null || rule.pattern == null) {
      return { rule, test: (): boolean => true };
    }
    const filter = compileFindingFilters([
      {
        id: rule.id,
        kind: rule.kind,
        pattern: rule.pattern,
        caseInquiryId: null,
      },
    ])[0];
    return { rule, test: (f: RuleFinding): boolean => filter.test(f) };
  });

  const out: PlannedLink[] = [];
  const taken = new Set(held);
  for (const finding of findings) {
    for (const { rule, test } of compiled) {
      const pair = linkKey(finding.caseFindingId, rule.threadId);
      if (taken.has(pair)) continue;
      if (!test(finding)) continue;
      taken.add(pair);
      out.push({
        caseFindingId: finding.caseFindingId,
        threadId: rule.threadId,
        stance: rule.stance,
        ruleId: rule.id,
      });
    }
  }
  return out;
}

/** The key of a (case finding, hypothesis) pair in a `held` set. */
export function linkKey(caseFindingId: string, threadId: string): string {
  return `${caseFindingId}\u0000${threadId}`;
}

/** A rule in words, for a timeline entry or a chip tooltip. */
export function describeRuleMatcher(
  kind: FindingFilterKind | null,
  pattern: string | null,
): string {
  if (kind == null || pattern == null) return 'every answer';
  return kind === 'FINDING_TYPE' ? `type ${pattern}` : `value ~ ${pattern}`;
}
