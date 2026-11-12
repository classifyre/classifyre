import {
  failureText,
  keyFrom,
  meets,
  qualityIdentity,
  qualityScore,
  RuleError,
  validateRule,
} from './quality-rules';

const base = {
  name: 'No personal data in notes',
  dimension: 'conformity',
  type: 'detector',
  metric: 'openFindings',
  operator: 'mustBe',
  threshold: 0,
};

describe('quality rules (GOV §5.4)', () => {
  it('normalises a detector rule and derives key and unit', () => {
    const rule = validateRule({
      ...base,
      columnName: 'notes',
      arguments: { detectorType: 'PII', bogus: 'x' },
    });
    expect(rule).toMatchObject({
      key: 'no-personal-data-in-notes',
      unit: 'findings',
      severity: 'MEDIUM',
      enabled: true,
      columnName: 'notes',
      arguments: { detectorType: 'PII' },
    });
  });

  it('refuses what cannot be measured or compared', () => {
    expect(() => validateRule({ ...base, metric: 'nullValues' })).toThrow(
      RuleError,
    );
    expect(() =>
      validateRule({ ...base, operator: 'mustBeBetween', threshold: 3 }),
    ).toThrow(/low, high/);
    expect(() =>
      validateRule({ ...base, operator: 'mustBeBetween', threshold: [5, 1] }),
    ).toThrow(RuleError);
    expect(() => validateRule({ ...base, threshold: '0' })).toThrow(/number/);
    expect(() =>
      validateRule({
        ...base,
        type: 'metadata',
        metric: 'rowCount',
        columnName: 'id',
      }),
    ).toThrow(/whole table/);
    expect(() => validateRule({ ...base, key: 'Bad Key' })).toThrow(/key/);
  });

  it('keeps what a partial update leaves out', () => {
    const current = validateRule(base);
    const next = validateRule(
      { threshold: 2, operator: 'mustBeLessThan' },
      current,
    );
    expect(next).toMatchObject({
      name: base.name,
      key: current.key,
      operator: 'mustBeLessThan',
      threshold: 2,
    });
  });

  it('compares with inclusive between bounds', () => {
    expect(meets('mustBe', 0, 0)).toBe(true);
    expect(meets('mustNotBe', 0, 0)).toBe(false);
    expect(meets('mustBeGreaterThan', 5, 5)).toBe(false);
    expect(meets('mustBeGreaterOrEqualTo', 5, 5)).toBe(true);
    expect(meets('mustBeLessThan', 4, 5)).toBe(true);
    expect(meets('mustBeLessOrEqualTo', 6, 5)).toBe(false);
    expect(meets('mustBeBetween', 10, [10, 20])).toBe(true);
    expect(meets('mustBeBetween', 21, [10, 20])).toBe(false);
    expect(meets('mustNotBeBetween', 20, [10, 20])).toBe(false);
    expect(meets('mustNotBeBetween', 9, [10, 20])).toBe(true);
  });

  it('says what failed, in words', () => {
    const rule = validateRule({ ...base, columnName: 'notes' });
    expect(failureText(rule, 3)).toBe(
      'notes: 3 findings (must be 0) — No personal data in notes',
    );
    const fresh = validateRule({
      name: 'Fresh',
      dimension: 'timeliness',
      type: 'metadata',
      metric: 'freshness',
      operator: 'mustBeBetween',
      threshold: [0, 24],
    });
    expect(failureText(fresh, 30.25)).toBe(
      '30.3 hours (must be between 0 and 24) — Fresh',
    );
  });

  it('scores by severity and ignores rules without results', () => {
    expect(qualityScore([])).toBeNull();
    expect(qualityScore([{ severity: 'HIGH', passed: null }])).toBeNull();
    expect(
      qualityScore([
        { severity: 'CRITICAL', passed: true },
        { severity: 'LOW', passed: false },
        { severity: 'INFO', passed: false },
      ]),
    ).toBe(89);
  });

  it('keeps one identity per rule', () => {
    expect(qualityIdentity('r1')).toHaveLength(64);
    expect(qualityIdentity('r1')).toBe(qualityIdentity('r1'));
    expect(qualityIdentity('r1')).not.toBe(qualityIdentity('r2'));
    expect(keyFrom('Null values in E-mail!')).toBe('null-values-in-e-mail');
  });
});
