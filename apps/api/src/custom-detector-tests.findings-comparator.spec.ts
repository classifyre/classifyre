import { compareFindingsOutcome } from './custom-detector-tests.findings-comparator';

const findings = [
  {
    finding_type: 'total_mismatch',
    identity_key: 'row-2',
    matched_content: 'total 11 != 10',
    severity: 'high',
  },
  {
    finding_type: 'total_mismatch',
    identity_key: 'row-5',
    matched_content: 'total 3 != 2',
    severity: 'medium',
  },
  { finding_type: 'over_limit', matched_content: '150', severity: 'low' },
];

describe('compareFindingsOutcome', () => {
  it('passes a subset match by label and identity', () => {
    expect(
      compareFindingsOutcome(
        { findings: [{ label: 'total_mismatch', identity: 'row-2' }] },
        findings,
      ).status,
    ).toBe('PASS');
  });

  it('checks counts, severity and value', () => {
    expect(
      compareFindingsOutcome(
        { findings: [{ label: 'total_mismatch', count: 2 }] },
        findings,
      ).status,
    ).toBe('PASS');
    const result = compareFindingsOutcome(
      { findings: [{ label: 'total_mismatch', severity: 'high', count: 2 }] },
      findings,
    );
    expect(result.status).toBe('FAIL');
    expect(result.explanation).toContain('got 1');
    expect(
      compareFindingsOutcome(
        { findings: [{ label: 'over_limit', value: '150' }] },
        findings,
      ).status,
    ).toBe('PASS');
  });

  it('exact refuses findings no expected entry names', () => {
    const result = compareFindingsOutcome(
      { findings: [{ label: 'total_mismatch' }], match: 'exact' },
      findings,
    );
    expect(result.status).toBe('FAIL');
    expect(result.explanation).toContain('unexpected finding(s): over_limit');
  });

  it('shouldMatch false asserts silence', () => {
    expect(compareFindingsOutcome({ shouldMatch: false }, []).status).toBe(
      'PASS',
    );
    expect(
      compareFindingsOutcome({ shouldMatch: false }, findings).explanation,
    ).toContain('Expected no findings');
  });

  it('names a missing label', () => {
    const result = compareFindingsOutcome(
      { findings: [{ label: 'never' }] },
      findings,
    );
    expect(result.status).toBe('FAIL');
    expect(result.explanation).toContain('"never"');
  });
});
