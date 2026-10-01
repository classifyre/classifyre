/**
 * Expected-outcome matching for code detectors (CODE_DETECTOR).
 *
 * A code detector reports a *list* of findings, each named by its label and
 * made stable by its identity, so a scenario asserts a list too:
 *
 *   { "findings": [{ "label": "total_mismatch", "identity": "row-2",
 *                    "severity": "high", "count": 1 }],
 *     "match": "subset" | "exact" }
 *
 * Each expected entry matches findings by label plus whichever of identity,
 * value and severity it names; `count` (when given) is how many must match.
 * `subset` (the default) allows other findings; `exact` refuses any finding
 * whose label no expected entry names. `{ "shouldMatch": false }` asserts the
 * rule stays silent, `{ "shouldMatch": true }` that it says anything at all.
 */

type Json = Record<string, unknown>;

export interface ExpectedFindingSpec {
  label: string;
  identity?: string;
  value?: string;
  severity?: string;
  count?: number;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return value == null ? '' : JSON.stringify(value);
}

function describe(finding: Json): string {
  const label = text(finding.finding_type ?? finding.findingType);
  const identity = text(finding.identity_key ?? finding.identityKey);
  const value = text(finding.matched_content ?? finding.matchedContent);
  return `${label}${identity ? `#${identity}` : ''}=${JSON.stringify(value.slice(0, 60))}`;
}

function matchesSpec(finding: Json, spec: ExpectedFindingSpec): boolean {
  if (text(finding.finding_type ?? finding.findingType) !== spec.label) {
    return false;
  }
  if (
    spec.identity !== undefined &&
    text(finding.identity_key ?? finding.identityKey) !== spec.identity
  ) {
    return false;
  }
  if (
    spec.value !== undefined &&
    text(finding.matched_content ?? finding.matchedContent) !== spec.value
  ) {
    return false;
  }
  if (
    spec.severity !== undefined &&
    text(finding.severity).toLowerCase() !== spec.severity.toLowerCase()
  ) {
    return false;
  }
  return true;
}

export function isFindingsExpectation(expected: Json): boolean {
  return Array.isArray(expected.findings) || 'shouldMatch' in expected;
}

export function compareFindingsOutcome(
  expected: Json,
  findings: unknown[],
): { status: 'PASS' | 'FAIL'; explanation: string | null } {
  const actual = findings.filter(
    (finding): finding is Json =>
      Boolean(finding) &&
      typeof finding === 'object' &&
      !Array.isArray(finding),
  );
  const summary =
    actual.length > 0
      ? `actual findings: ${actual.slice(0, 10).map(describe).join(', ')}${actual.length > 10 ? `, … (${actual.length} total)` : ''}`
      : 'no findings were produced';

  if (!Array.isArray(expected.findings)) {
    const shouldMatch = Boolean(expected.shouldMatch);
    if (shouldMatch === actual.length > 0) {
      return { status: 'PASS', explanation: null };
    }
    return {
      status: 'FAIL',
      explanation: shouldMatch
        ? 'Expected at least one finding; no findings were produced.'
        : `Expected no findings; ${summary}.`,
    };
  }

  const specs: ExpectedFindingSpec[] = [];
  for (const raw of expected.findings as unknown[]) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      typeof (raw as Json).label !== 'string'
    ) {
      return {
        status: 'FAIL',
        explanation: 'Every expected finding needs a "label".',
      };
    }
    specs.push(raw as ExpectedFindingSpec);
  }

  const problems: string[] = [];
  for (const spec of specs) {
    const hits = actual.filter((finding) => matchesSpec(finding, spec)).length;
    const wanted = typeof spec.count === 'number' ? spec.count : null;
    if (wanted === null ? hits === 0 : hits !== wanted) {
      const qualifiers = [
        spec.identity !== undefined ? `identity "${spec.identity}"` : null,
        spec.value !== undefined ? `value "${spec.value}"` : null,
        spec.severity !== undefined ? `severity ${spec.severity}` : null,
      ].filter(Boolean);
      problems.push(
        `expected ${wanted ?? 'at least 1'} "${spec.label}" finding(s)` +
          (qualifiers.length ? ` with ${qualifiers.join(', ')}` : '') +
          `, got ${hits}`,
      );
    }
  }

  if (expected.match === 'exact') {
    const labels = new Set(specs.map((spec) => spec.label));
    const extra = actual.filter(
      (finding) =>
        !labels.has(text(finding.finding_type ?? finding.findingType)),
    );
    if (extra.length > 0) {
      problems.push(
        `unexpected finding(s): ${extra.slice(0, 5).map(describe).join(', ')}`,
      );
    }
  }

  if (problems.length === 0) return { status: 'PASS', explanation: null };
  return { status: 'FAIL', explanation: `${problems.join('; ')}; ${summary}.` };
}
