import { assertUuid, isUuid } from './agent-ids';

/**
 * Malformed ids the agent composed rather than copied, taken from a live run.
 * Both produced "not found", which reads as "that row is gone" — so the agent
 * tried another plausible id instead of stopping.
 */
describe('assertUuid', () => {
  const REAL = '4c05dc53-315b-47f1-b6df-e08f16653721';

  it('accepts a real id unchanged', () => {
    expect(assertUuid(REAL, 'caseId')).toBe(REAL);
  });

  it('trims surrounding whitespace', () => {
    expect(assertUuid(` ${REAL} `, 'caseId')).toBe(REAL);
  });

  it('names the field and the shape it received', () => {
    // 10-4-4-12: the threadId one run repeated four times.
    expect(() =>
      assertUuid('e9a5610357-4199-93cd-658b1bf0e536', 'threadId'),
    ).toThrow(/threadId .* group lengths 10-4-4-12 where 8-4-4-4-12/);
  });

  it('catches a shape that is only one character off', () => {
    // 8-3-4-4-12 — the caseId that failed as "Case not found".
    expect(() =>
      assertUuid('e19fe273-cfe-481a-ac25-139f94fceb5a', 'caseId'),
    ).toThrow(/8-3-4-4-12/);
  });

  // The corrective half: knowing it is malformed is only useful with somewhere
  // to get a real one.
  it('says where a real id comes from', () => {
    expect(() =>
      assertUuid('nope', 'caseId', 'Take it from cases.list.'),
    ).toThrow(/Take it from cases\.list\./);
    expect(() => assertUuid('nope', 'caseId')).toThrow(/never composed/);
  });

  it('rejects a missing or empty value', () => {
    expect(() => assertUuid(undefined, 'caseId')).toThrow(/required/);
    expect(() => assertUuid('   ', 'caseId')).toThrow(/required/);
    expect(() => assertUuid(42, 'caseId')).toThrow(/required/);
  });

  it('isUuid agrees without throwing', () => {
    expect(isUuid(REAL)).toBe(true);
    expect(isUuid('e19fe273-cfe-481a-ac25-139f94fceb5a')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
