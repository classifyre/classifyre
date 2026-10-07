import {
  linkKey,
  planLinks,
  ruleMatcherProblem,
  type HypothesisRuleSpec,
  type RuleFinding,
} from './case-hypothesis-rules.rules';

const at = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, n));

function rule(
  id: string,
  threadId: string,
  over: Partial<HypothesisRuleSpec> = {},
): HypothesisRuleSpec {
  return {
    id,
    threadId,
    stance: 'SUPPORTS',
    kind: null,
    pattern: null,
    createdAt: at(Number(id.replace(/\D/g, '')) || 0),
    ...over,
  };
}

function finding(id: string, type: string, value: string): RuleFinding {
  return { caseFindingId: id, findingType: type, matchedContent: value };
}

describe('ruleMatcherProblem', () => {
  it('accepts a rule with no matcher (every answer)', () => {
    expect(ruleMatcherProblem(null, null)).toBeNull();
    expect(ruleMatcherProblem(undefined, '')).toBeNull();
  });

  it('wants kind and pattern together', () => {
    expect(ruleMatcherProblem('FINDING_TYPE', null)).toMatch(/both/);
    expect(ruleMatcherProblem(null, 'x')).toMatch(/both/);
  });

  it('rejects a pattern that is not a regular expression', () => {
    expect(ruleMatcherProblem('VALUE_PATTERN', '(')).toMatch(/regular/);
    expect(ruleMatcherProblem('VALUE_PATTERN', '^AT\\d+')).toBeNull();
  });
});

describe('planLinks', () => {
  const f1 = finding('cf1', 'acute_insolvency_risk', 'FN 1');
  const f2 = finding('cf2', 'newly_registered', 'FN 2');

  it('links every finding when the rule names no matcher', () => {
    const plan = planLinks([rule('r1', 'h1')], [f1, f2]);
    expect(plan.map((p) => [p.caseFindingId, p.threadId, p.stance])).toEqual([
      ['cf1', 'h1', 'SUPPORTS'],
      ['cf2', 'h1', 'SUPPORTS'],
    ]);
    expect(plan.every((p) => p.ruleId === 'r1')).toBe(true);
  });

  it('narrows by finding type or value pattern', () => {
    const byType = rule('r1', 'h1', {
      kind: 'FINDING_TYPE',
      pattern: 'newly_registered',
    });
    const byValue = rule('r2', 'h2', {
      kind: 'VALUE_PATTERN',
      pattern: 'FN 1$',
      stance: 'CONTRADICTS',
    });
    const plan = planLinks([byType, byValue], [f1, f2]);
    expect(plan.map((p) => [p.caseFindingId, p.threadId, p.stance])).toEqual([
      ['cf1', 'h2', 'CONTRADICTS'],
      ['cf2', 'h1', 'SUPPORTS'],
    ]);
  });

  it('sends one finding to several hypotheses, each with its own stance', () => {
    const plan = planLinks(
      [rule('r1', 'h1'), rule('r2', 'h2', { stance: 'NEUTRAL' })],
      [f1],
    );
    expect(plan.map((p) => [p.threadId, p.stance]).sort()).toEqual([
      ['h1', 'SUPPORTS'],
      ['h2', 'NEUTRAL'],
    ]);
  });

  it('lets the narrower rule win when two rules name the same hypothesis', () => {
    const catchAll = rule('r1', 'h1', { stance: 'SUPPORTS' });
    const narrow = rule('r2', 'h1', {
      stance: 'CONTRADICTS',
      kind: 'FINDING_TYPE',
      pattern: 'newly_registered',
    });
    const plan = planLinks([catchAll, narrow], [f1, f2]);
    const stanceOf = (id: string) =>
      plan.find((p) => p.caseFindingId === id)?.stance;
    expect(stanceOf('cf1')).toBe('SUPPORTS');
    expect(stanceOf('cf2')).toBe('CONTRADICTS');
    expect(plan).toHaveLength(2);
  });

  it('prefers the older rule between equals, whatever the input order', () => {
    const older = rule('r1', 'h1', { stance: 'SUPPORTS', createdAt: at(1) });
    const newer = rule('r2', 'h1', { stance: 'CONTRADICTS', createdAt: at(2) });
    expect(planLinks([newer, older], [f1])[0].stance).toBe('SUPPORTS');
    expect(planLinks([older, newer], [f1])[0].stance).toBe('SUPPORTS');
  });

  it('leaves pairs that are already linked alone', () => {
    const held = new Set([linkKey('cf1', 'h1')]);
    const plan = planLinks([rule('r1', 'h1'), rule('r2', 'h2')], [f1], held);
    expect(plan.map((p) => p.threadId)).toEqual(['h2']);
  });

  it('matches nothing with a value pattern that does not compile', () => {
    const broken = rule('r1', 'h1', { kind: 'VALUE_PATTERN', pattern: '(' });
    expect(planLinks([broken], [f1])).toEqual([]);
  });

  it('plans nothing without rules or findings', () => {
    expect(planLinks([], [f1])).toEqual([]);
    expect(planLinks([rule('r1', 'h1')], [])).toEqual([]);
  });
});
