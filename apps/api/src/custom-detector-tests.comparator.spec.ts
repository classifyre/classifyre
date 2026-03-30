/**
 * Comparator unit tests for all three custom-detector test methods:
 *   CLASSIFIER — CLI emits finding_type = "class:<label>"
 *   ENTITY     — CLI emits finding_type = "entity:<label>"
 *   RULESET    — in-process evaluation returns { matched: boolean }
 *
 * Bug 2 fix: CLASSIFIER/ENTITY comparator must strip the CLI prefix before
 * matching against the user-supplied expected label.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Replicate the comparator logic in isolation (no NestJS DI needed).
// These functions mirror CustomDetectorTestsService.compareOutcome().
// ─────────────────────────────────────────────────────────────────────────────

type Finding = Record<string, unknown>;

function normalizeClassifierType(rawType: string): string {
  return rawType.toLowerCase().replace(/^class:/, '');
}

function normalizeEntityType(rawType: string): string {
  return rawType.toLowerCase().replace(/^entity:/, '');
}

function compareClassifier(
  expected: { label: string; minConfidence?: number },
  findings: Finding[],
): 'PASS' | 'FAIL' {
  const expectedLabel = expected.label.toLowerCase();
  const minConf =
    typeof expected.minConfidence === 'number' ? expected.minConfidence : 0;

  const hit = findings.some((f) => {
    // Support both snake_case (CLI) and camelCase (internal normalisation)
    const rawType =
      (f.finding_type as string | undefined) ??
      (f.findingType as string | undefined) ??
      '';
    const normalizedType = normalizeClassifierType(rawType);
    const labelMatch = normalizedType === expectedLabel;
    const conf = typeof f.confidence === 'number' ? f.confidence : 1;
    return labelMatch && conf >= minConf;
  });
  return hit ? 'PASS' : 'FAIL';
}

function compareEntity(
  expected: { entities: Array<{ label: string; text?: string }> },
  findings: Finding[],
): 'PASS' | 'FAIL' {
  const allFound = expected.entities.every((exp) => {
    const expLabel = exp.label.toLowerCase();
    const expText = exp.text ? exp.text.toLowerCase() : null;
    return findings.some((f) => {
      const rawType =
        (f.finding_type as string | undefined) ??
        (f.findingType as string | undefined) ??
        '';
      const normalizedType = normalizeEntityType(rawType);
      if (normalizedType !== expLabel) return false;
      if (expText === null) return true;
      const rawContent =
        (f.matched_content as string | undefined) ??
        (f.matchedContent as string | undefined) ??
        '';
      return rawContent.toLowerCase().includes(expText);
    });
  });
  return allFound ? 'PASS' : 'FAIL';
}

function compareRuleset(
  expected: Record<string, unknown>,
  actual: { matched: boolean },
): 'PASS' | 'FAIL' {
  const shouldMatch = Boolean(expected.shouldMatch);
  const didMatch = Boolean(actual.matched);
  return shouldMatch === didMatch ? 'PASS' : 'FAIL';
}

/**
 * Full compareOutcome — mirrors CustomDetectorTestsService.compareOutcome().
 * Accepts the `actual` shape returned by evaluateViaCli / evaluateRuleset.
 */
function compareOutcome(
  method: string,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): 'PASS' | 'FAIL' {
  if (method === 'RULESET') {
    return compareRuleset(expected, { matched: Boolean(actual.matched) });
  }

  const findings: Finding[] = Array.isArray(actual.findings)
    ? actual.findings
    : [];

  if (method === 'CLASSIFIER') {
    return compareClassifier(
      {
        label: (expected.label as string | undefined) ?? '',
        minConfidence:
          typeof expected.minConfidence === 'number'
            ? expected.minConfidence
            : undefined,
      },
      findings,
    );
  }

  if (method === 'ENTITY') {
    return compareEntity(
      {
        entities: Array.isArray(expected.entities)
          ? (expected.entities as Array<{ label: string; text?: string }>)
          : [],
      },
      findings,
    );
  }

  return 'FAIL';
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFIER comparator
// ─────────────────────────────────────────────────────────────────────────────

describe('compareClassifier (Bug 2 — class: prefix)', () => {
  it('PASS: CLI "class:sports" matches expected label "sports"', () => {
    const result = compareClassifier({ label: 'sports', minConfidence: 0.5 }, [
      { finding_type: 'class:sports', confidence: 0.97 },
    ]);
    expect(result).toBe('PASS');
  });

  it('FAIL: plain "sports" (no prefix) would have been the old broken match', () => {
    // Without stripping, "class:sports" !== "sports" → FAIL
    const rawMatch = 'class:sports'.toLowerCase() === 'sports';
    expect(rawMatch).toBe(false);
  });

  it('PASS: mixed-case CLI output still matches', () => {
    const result = compareClassifier({ label: 'Finance' }, [
      { finding_type: 'class:Finance', confidence: 0.8 },
    ]);
    expect(result).toBe('PASS');
  });

  it('FAIL: wrong label does not match', () => {
    const result = compareClassifier({ label: 'sports' }, [
      { finding_type: 'class:finance', confidence: 0.9 },
    ]);
    expect(result).toBe('FAIL');
  });

  it('FAIL: confidence below minConfidence threshold', () => {
    const result = compareClassifier({ label: 'sports', minConfidence: 0.9 }, [
      { finding_type: 'class:sports', confidence: 0.5 },
    ]);
    expect(result).toBe('FAIL');
  });

  it('PASS: multiple findings, one matches', () => {
    const result = compareClassifier({ label: 'sports', minConfidence: 0.7 }, [
      { finding_type: 'class:finance', confidence: 0.95 },
      { finding_type: 'class:sports', confidence: 0.82 },
    ]);
    expect(result).toBe('PASS');
  });

  it('FAIL: empty findings array', () => {
    const result = compareClassifier({ label: 'sports' }, []);
    expect(result).toBe('FAIL');
  });

  it('PASS: no minConfidence means 0 — any confidence passes', () => {
    // confidence missing → defaults to 1, which is >= 0
    const result = compareClassifier({ label: 'sports' }, [
      { finding_type: 'class:sports' },
    ]);
    expect(result).toBe('PASS');
  });

  it('PASS: camelCase findingType (internal normalisation path)', () => {
    const result = compareClassifier(
      { label: 'sports', minConfidence: 0.5 },
      // findingType (camelCase) instead of finding_type
      [{ findingType: 'class:sports', confidence: 0.9 } as Finding],
    );
    expect(result).toBe('PASS');
  });

  it('PASS: confidence exactly equal to minConfidence threshold', () => {
    const result = compareClassifier({ label: 'sports', minConfidence: 0.75 }, [
      { finding_type: 'class:sports', confidence: 0.75 },
    ]);
    expect(result).toBe('PASS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY comparator
// ─────────────────────────────────────────────────────────────────────────────

describe('compareEntity (Bug 2 — entity: prefix)', () => {
  it('PASS: CLI "entity:person" matches expected label "person"', () => {
    const result = compareEntity({ entities: [{ label: 'person' }] }, [
      { finding_type: 'entity:person', matched_content: 'Alice' },
    ]);
    expect(result).toBe('PASS');
  });

  it('PASS: entity label + text both match', () => {
    const result = compareEntity(
      { entities: [{ label: 'person', text: 'alice' }] },
      [{ finding_type: 'entity:person', matched_content: 'Alice Smith' }],
    );
    expect(result).toBe('PASS');
  });

  it('FAIL: text does not appear in matched_content', () => {
    const result = compareEntity(
      { entities: [{ label: 'person', text: 'bob' }] },
      [{ finding_type: 'entity:person', matched_content: 'Alice Smith' }],
    );
    expect(result).toBe('FAIL');
  });

  it('FAIL: entity label not found', () => {
    const result = compareEntity({ entities: [{ label: 'location' }] }, [
      { finding_type: 'entity:person', matched_content: 'Alice' },
    ]);
    expect(result).toBe('FAIL');
  });

  it('PASS: all expected entities found (multiple)', () => {
    const result = compareEntity(
      { entities: [{ label: 'person' }, { label: 'organization' }] },
      [
        { finding_type: 'entity:person', matched_content: 'Alice' },
        { finding_type: 'entity:organization', matched_content: 'Acme Corp' },
      ],
    );
    expect(result).toBe('PASS');
  });

  it('FAIL: only some expected entities found', () => {
    const result = compareEntity(
      { entities: [{ label: 'person' }, { label: 'location' }] },
      [{ finding_type: 'entity:person', matched_content: 'Alice' }],
    );
    expect(result).toBe('FAIL');
  });

  it('PASS: empty entities array — every() vacuously true', () => {
    // If the expected list is empty there is nothing to satisfy → PASS
    const result = compareEntity({ entities: [] }, []);
    expect(result).toBe('PASS');
  });

  it('PASS: camelCase matchedContent (internal normalisation path)', () => {
    const result = compareEntity(
      { entities: [{ label: 'person', text: 'alice' }] },
      [
        {
          finding_type: 'entity:person',
          matchedContent: 'Alice Smith',
        } as Finding,
      ],
    );
    expect(result).toBe('PASS');
  });

  it('PASS: upper-case CLI label "PERSON" matches expected label "person"', () => {
    // CLI GLiNER emits entity labels in upper-case sometimes
    const result = compareEntity({ entities: [{ label: 'person' }] }, [
      { finding_type: 'entity:PERSON', matched_content: 'Bob' },
    ]);
    expect(result).toBe('PASS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RULESET comparator
// ─────────────────────────────────────────────────────────────────────────────

describe('compareRuleset', () => {
  it('PASS: shouldMatch=true and text matched a rule', () => {
    expect(compareRuleset({ shouldMatch: true }, { matched: true })).toBe(
      'PASS',
    );
  });

  it('PASS: shouldMatch=false and text did NOT match any rule', () => {
    expect(compareRuleset({ shouldMatch: false }, { matched: false })).toBe(
      'PASS',
    );
  });

  it('FAIL: shouldMatch=true but no rule fired', () => {
    expect(compareRuleset({ shouldMatch: true }, { matched: false })).toBe(
      'FAIL',
    );
  });

  it('FAIL: shouldMatch=false but a rule fired unexpectedly', () => {
    expect(compareRuleset({ shouldMatch: false }, { matched: true })).toBe(
      'FAIL',
    );
  });

  it('PASS: shouldMatch missing defaults to false — and no match', () => {
    // Boolean(undefined) === false
    expect(compareRuleset({}, { matched: false })).toBe('PASS');
  });

  it('FAIL: shouldMatch missing defaults to false — but a rule fired', () => {
    expect(compareRuleset({}, { matched: true })).toBe('FAIL');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// compareOutcome — full method dispatch (mirrors the service)
// ─────────────────────────────────────────────────────────────────────────────

describe('compareOutcome (full dispatch)', () => {
  // ── RULESET ──────────────────────────────────────────────────────────────

  it('RULESET PASS: shouldMatch=true, rule fired', () => {
    expect(
      compareOutcome('RULESET', { shouldMatch: true }, { matched: true }),
    ).toBe('PASS');
  });

  it('RULESET FAIL: shouldMatch=true, rule did not fire', () => {
    expect(
      compareOutcome('RULESET', { shouldMatch: true }, { matched: false }),
    ).toBe('FAIL');
  });

  it('RULESET PASS: shouldMatch=false, no rule fired', () => {
    expect(
      compareOutcome('RULESET', { shouldMatch: false }, { matched: false }),
    ).toBe('PASS');
  });

  // ── CLASSIFIER ───────────────────────────────────────────────────────────

  it('CLASSIFIER PASS: "class:sports" matches label "sports"', () => {
    expect(
      compareOutcome(
        'CLASSIFIER',
        { label: 'sports', minConfidence: 0.5 },
        { findings: [{ finding_type: 'class:sports', confidence: 0.9 }] },
      ),
    ).toBe('PASS');
  });

  it('CLASSIFIER FAIL: label mismatch', () => {
    expect(
      compareOutcome(
        'CLASSIFIER',
        { label: 'sports' },
        { findings: [{ finding_type: 'class:finance', confidence: 0.9 }] },
      ),
    ).toBe('FAIL');
  });

  it('CLASSIFIER FAIL: no findings', () => {
    expect(
      compareOutcome('CLASSIFIER', { label: 'sports' }, { findings: [] }),
    ).toBe('FAIL');
  });

  it('CLASSIFIER FAIL: findings key missing from actual', () => {
    // evaluateViaCli always returns findings but guard against missing key
    expect(compareOutcome('CLASSIFIER', { label: 'sports' }, {})).toBe('FAIL');
  });

  // ── ENTITY ───────────────────────────────────────────────────────────────

  it('ENTITY PASS: entity:PERSON matches label "person"', () => {
    expect(
      compareOutcome(
        'ENTITY',
        { entities: [{ label: 'person' }] },
        {
          findings: [
            { finding_type: 'entity:PERSON', matched_content: 'Alice' },
          ],
        },
      ),
    ).toBe('PASS');
  });

  it('ENTITY FAIL: entity label not found', () => {
    expect(
      compareOutcome(
        'ENTITY',
        { entities: [{ label: 'location' }] },
        {
          findings: [
            { finding_type: 'entity:PERSON', matched_content: 'Alice' },
          ],
        },
      ),
    ).toBe('FAIL');
  });

  it('ENTITY PASS: empty expected entities list', () => {
    expect(compareOutcome('ENTITY', { entities: [] }, { findings: [] })).toBe(
      'PASS',
    );
  });

  // ── Unknown method ────────────────────────────────────────────────────────

  it('FAIL: unknown method always returns FAIL', () => {
    expect(compareOutcome('UNKNOWN_METHOD', {}, { findings: [] })).toBe('FAIL');
  });
});
