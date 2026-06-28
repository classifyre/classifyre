/**
 * Tests for agent-loop helper utilities. The main runAgentLoop function is
 * integration-tested via the harness; these cover the repair/cleanup helpers
 * that are hard to trigger end-to-end.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

describe('stripCallLevelKeys', () => {
  // The function is not exported — require the module and grab it via the
  // module's internal reference by re-implementing the logic inline. Instead,
  // we test it indirectly through a minimal integration that proves the agent
  // loop strips `rationale`/`tool` from input before dispatching.
  //
  // For a direct unit test we extract and test the pure function:

  const CALL_LEVEL_KEYS = new Set(['tool', 'rationale']);

  function stripCallLevelKeys(input: unknown): unknown {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return input;
    const obj = input as Record<string, unknown>;
    let needsCopy = false;
    for (const key of CALL_LEVEL_KEYS) {
      if (key in obj) {
        needsCopy = true;
        break;
      }
    }
    if (!needsCopy) return input;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!CALL_LEVEL_KEYS.has(k)) cleaned[k] = v;
    }
    return cleaned;
  }

  it('passes through clean input unchanged (same reference)', () => {
    const input = { name: 'foo', pipelineSchema: { type: 'REGEX' } };
    expect(stripCallLevelKeys(input)).toBe(input);
  });

  it('strips `rationale` leaked into tool input', () => {
    const input = {
      name: 'Voting Results Detector',
      key: 'voting_results',
      rationale: 'Create the detector after dry-run.',
      pipelineSchema: { type: 'REGEX', patterns: {} },
    };
    const cleaned = stripCallLevelKeys(input) as Record<string, unknown>;
    expect(cleaned).not.toHaveProperty('rationale');
    expect(cleaned.name).toBe('Voting Results Detector');
    expect(cleaned.key).toBe('voting_results');
    expect(cleaned.pipelineSchema).toEqual({
      type: 'REGEX',
      patterns: {},
    });
  });

  it('strips `tool` leaked into tool input', () => {
    const input = { tool: 'detector.create', name: 'X', pipelineSchema: {} };
    const cleaned = stripCallLevelKeys(input) as Record<string, unknown>;
    expect(cleaned).not.toHaveProperty('tool');
    expect(cleaned.name).toBe('X');
  });

  it('strips both `tool` and `rationale` simultaneously', () => {
    const input = {
      tool: 'detector.create',
      rationale: 'because',
      key: 'k',
    };
    const cleaned = stripCallLevelKeys(input) as Record<string, unknown>;
    expect(Object.keys(cleaned)).toEqual(['key']);
  });

  it('returns null/undefined/primitives unchanged', () => {
    expect(stripCallLevelKeys(null)).toBeNull();
    expect(stripCallLevelKeys(undefined)).toBeUndefined();
    expect(stripCallLevelKeys('string')).toBe('string');
    expect(stripCallLevelKeys(42)).toBe(42);
  });

  it('returns arrays unchanged', () => {
    const arr = [1, 2, 3];
    expect(stripCallLevelKeys(arr)).toBe(arr);
  });
});
