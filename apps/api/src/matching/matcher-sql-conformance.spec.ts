import { DetectorType, Prisma } from '@prisma/client';
import {
  candidateWhere,
  CompiledMatcher,
  exactInWhere,
  FindingCandidate,
  InquiryMatchers,
} from './inquiry-matcher';
import { primeTermSnapshot } from '../semantic/term-snapshot';
import type { CompiledBinding } from '../semantic/bindings/binding-spec';
import { emptyLookupIndex } from '../semantic/bindings/binding-compiler';
import { glossaryNorm } from '../glossary/glossary-norm';

/**
 * The two halves of a matcher, run over the same fixtures.
 *
 * A question is answered by two independent implementations: a Prisma `where`
 * (`candidateWhere`) and an in-memory predicate (`CompiledMatcher.matches`).
 * They are supposed to agree dimension for dimension, the code has said so in a
 * comment for a long time, and it drifted from its own comment anyway —
 * `customDetectorKeys` was OR'd with `detectorTypes`, so selecting `CUSTOM`
 * (which the API's own `/inquiries/match-options` endpoint invites you to do)
 * swallowed the key list and returned every custom finding in the namespace.
 * 7,551 of them, led by a trade catalogue, in a question about shell companies.
 *
 * That failure is silent and looks like success, which is exactly what a
 * conformance test is for. Two invariants, and the second is the sharp one:
 *
 *  1. SQL must never exclude a row the matcher accepts. A prefilter that drops
 *     matches loses findings outright.
 *  2. With no regex dimension configured, SQL must be EXACTLY the matcher.
 *     `previewRows` returns a COUNT(*) over the `where` and never consults the
 *     matcher on that path, so a divergence returns a wrong *number* to the
 *     caller rather than merely a wide candidate set.
 */

interface Row extends FindingCandidate {
  id: string;
  status: 'OPEN' | 'RESOLVED';
}

const rows: Row[] = [
  {
    id: 'pii-email-s1',
    status: 'OPEN',
    sourceId: 's1',
    detectorType: DetectorType.PII,
    findingType: 'email',
    customDetectorKey: null,
    matchedContent: 'a@b.example',
  },
  {
    id: 'pii-email-s2',
    status: 'OPEN',
    sourceId: 's2',
    detectorType: DetectorType.PII,
    findingType: 'email',
    customDetectorKey: null,
    matchedContent: 'c@d.example',
  },
  {
    id: 'secrets-s1',
    status: 'OPEN',
    sourceId: 's1',
    detectorType: DetectorType.SECRETS,
    findingType: 'aws_key',
    customDetectorKey: null,
    matchedContent: 'AKIA...',
  },
  // The two custom findings at the heart of the bug: one is the tag the
  // question is about, the other is the corpus-wide trade catalogue that
  // drowned it.
  {
    id: 'custom-distress',
    status: 'OPEN',
    sourceId: 's1',
    detectorType: DetectorType.CUSTOM,
    findingType: 'tag:Financial distress',
    customDetectorKey: 'fb_distress',
    matchedContent: 'negatives Eigenkapital',
  },
  {
    id: 'custom-trade',
    status: 'OPEN',
    sourceId: 's1',
    detectorType: DetectorType.CUSTOM,
    findingType: 'tag:Trade category',
    customDetectorKey: 'fb_trade_category',
    matchedContent: 'konzessioniertes Gewerbe',
  },
  {
    id: 'custom-shell-s2',
    status: 'OPEN',
    sourceId: 's2',
    detectorType: DetectorType.CUSTOM,
    findingType: 'tag:Shell-company risk',
    customDetectorKey: 'fb_shell_risk',
    matchedContent: 'hoch (5/12): amtswegig gelöscht',
  },
  // An LLM detector puts its answer in findingType, not matchedContent.
  {
    id: 'custom-llm',
    status: 'OPEN',
    sourceId: 's1',
    detectorType: DetectorType.CUSTOM,
    findingType: 'insolvenzgefahr_hoch',
    customDetectorKey: 'fb_solvency_outlook',
    matchedContent: 'Eigenkapital -194.756,31 EUR',
  },
  // Custom finding with no key at all — a shape the OR branch has to handle.
  {
    id: 'custom-keyless',
    status: 'OPEN',
    sourceId: 's1',
    detectorType: DetectorType.CUSTOM,
    findingType: 'unkeyed',
    customDetectorKey: null,
    matchedContent: 'whatever',
  },
  // Never a candidate: the `where` pins status OPEN.
  {
    id: 'resolved',
    status: 'RESOLVED',
    sourceId: 's1',
    detectorType: DetectorType.PII,
    findingType: 'email',
    customDetectorKey: null,
    matchedContent: 'e@f.example',
  },
];

const base: InquiryMatchers = {
  matchAllSources: false,
  sourceIds: [],
  detectorTypes: [],
  customDetectorKeys: [],
  findingTypes: [],
  findingTypeRegex: [],
  findingValueRegex: [],
};

/**
 * A deliberately tiny evaluator for the exact `FindingWhereInput` subset
 * `candidateWhere` emits: scalar equality, `{ in: [...] }`, and one top-level
 * `OR` of the same. It rejects anything else rather than guessing, so a future
 * `candidateWhere` that reaches for a new Prisma operator fails loudly here
 * instead of being silently approximated into agreement.
 */
function evaluate(where: Prisma.FindingWhereInput, row: Row): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (field === 'AND') {
      const parts = condition as Prisma.FindingWhereInput[];
      return parts.every((part) => evaluate(part, row));
    }
    if (field === 'OR') {
      const branches = condition as Prisma.FindingWhereInput[];
      return branches.some((branch) => evaluate(branch, row));
    }
    const actual = (row as unknown as Record<string, unknown>)[field] ?? null;
    if (condition !== null && typeof condition === 'object') {
      const operators = Object.keys(condition);
      if (operators.length !== 1 || operators[0] !== 'in') {
        throw new Error(
          `matcher-sql-conformance cannot evaluate operator(s) ` +
            `${operators.join(',')} on '${field}'. Teach evaluate() the new ` +
            `operator — do not relax the test.`,
        );
      }
      return ((condition as { in: unknown[] }).in ?? []).includes(actual);
    }
    return actual === condition;
  });
}

const bySql = (m: InquiryMatchers): string[] => {
  const where = candidateWhere(m);
  return rows.filter((row) => evaluate(where, row)).map((row) => row.id);
};

const byMatcher = (m: InquiryMatchers): string[] => {
  const matcher = new CompiledMatcher(m);
  // The matcher has no status dimension: every path that consults it has
  // already been narrowed to OPEN by the same `where`.
  return rows
    .filter((row) => row.status === 'OPEN' && matcher.matches(row))
    .map((row) => row.id);
};

const cases: Array<{ name: string; matchers: InquiryMatchers }> = [
  {
    name: 'source scope only',
    matchers: { ...base, sourceIds: ['s1'] },
  },
  {
    name: 'all sources',
    matchers: { ...base, matchAllSources: true },
  },
  {
    name: 'built-in detector type',
    matchers: {
      ...base,
      matchAllSources: true,
      detectorTypes: [DetectorType.PII],
    },
  },
  {
    name: 'two built-in detector types',
    matchers: {
      ...base,
      matchAllSources: true,
      detectorTypes: [DetectorType.PII, DetectorType.SECRETS],
    },
  },
  {
    name: 'CUSTOM alone matches every custom finding',
    matchers: {
      ...base,
      matchAllSources: true,
      detectorTypes: [DetectorType.CUSTOM],
    },
  },
  {
    name: 'custom keys alone',
    matchers: {
      ...base,
      matchAllSources: true,
      customDetectorKeys: ['fb_distress'],
    },
  },
  {
    // The exact combination /inquiries/match-options invites, and the one that
    // used to return the whole namespace.
    name: 'CUSTOM + custom keys — keys must restrict, not widen',
    matchers: {
      ...base,
      matchAllSources: true,
      detectorTypes: [DetectorType.CUSTOM],
      customDetectorKeys: ['fb_distress'],
    },
  },
  {
    name: 'built-in type + custom key — the built-in type is unaffected',
    matchers: {
      ...base,
      matchAllSources: true,
      detectorTypes: [DetectorType.PII],
      customDetectorKeys: ['fb_distress'],
    },
  },
  {
    name: 'CUSTOM + built-in type + custom key',
    matchers: {
      ...base,
      matchAllSources: true,
      detectorTypes: [DetectorType.CUSTOM, DetectorType.SECRETS],
      customDetectorKeys: ['fb_shell_risk'],
    },
  },
  {
    name: 'exact finding types',
    matchers: {
      ...base,
      matchAllSources: true,
      findingTypes: ['email', 'insolvenzgefahr_hoch'],
    },
  },
  {
    name: 'custom key + exact finding type',
    matchers: {
      ...base,
      matchAllSources: true,
      customDetectorKeys: ['fb_solvency_outlook'],
      findingTypes: ['insolvenzgefahr_hoch'],
    },
  },
  {
    name: 'source scope + CUSTOM + keys',
    matchers: {
      ...base,
      sourceIds: ['s2'],
      detectorTypes: [DetectorType.CUSTOM],
      customDetectorKeys: ['fb_shell_risk', 'fb_distress'],
    },
  },
];

const regexCases: Array<{ name: string; matchers: InquiryMatchers }> = [
  {
    name: 'value regex',
    matchers: {
      ...base,
      matchAllSources: true,
      findingValueRegex: ['amtswegig gelöscht'],
    },
  },
  {
    name: 'type regex',
    matchers: { ...base, matchAllSources: true, findingTypeRegex: ['^tag:'] },
  },
  {
    name: 'custom key + value regex',
    matchers: {
      ...base,
      matchAllSources: true,
      customDetectorKeys: ['fb_shell_risk'],
      findingValueRegex: ['hoch'],
    },
  },
  {
    // The §5.10 shape: a TAG matcher pointed at an LLM detector matches
    // nothing, and SQL must still be a superset rather than disagreeing.
    name: 'value regex against a detector that answers in findingType',
    matchers: {
      ...base,
      matchAllSources: true,
      customDetectorKeys: ['fb_solvency_outlook'],
      findingValueRegex: ['insolvenzgefahr_hoch'],
    },
  },
  {
    name: 'exact types are NOT pushed into SQL when a regex is present',
    matchers: {
      ...base,
      matchAllSources: true,
      findingTypes: ['email'],
      findingTypeRegex: ['^tag:'],
    },
  },
];

// ── Term dimension (SL3 R7.6) ───────────────────────────────────────────────

function binding(
  id: string,
  partial: Partial<CompiledBinding>,
): CompiledBinding {
  return {
    id,
    mode: 'OUTPUT',
    detectorType: null,
    customDetectorKey: null,
    findingType: null,
    metadataPath: null,
    values: [],
    splitDelimiter: null,
    termId: null,
    lookupSchemeId: null,
    lookupMatch: null,
    noMeaning: false,
    sourceIds: [],
    confidence: 1,
    ...partial,
  };
}

function primeTerms(): void {
  primeTermSnapshot({
    active: {
      bindings: [
        binding('b-distress', {
          detectorType: DetectorType.CUSTOM,
          customDetectorKey: 'fb_distress',
          findingType: 'tag:Financial distress',
          termId: 't-distress',
        }),
        binding('b-email', {
          detectorType: DetectorType.PII,
          findingType: 'email',
          termId: 't-email',
        }),
        // Scoped to one source: s2's emails are not evidence through it.
        binding('b-email-scoped', {
          detectorType: DetectorType.PII,
          findingType: 'email',
          termId: 't-contact',
          sourceIds: ['s1'],
        }),
        binding('b-shell', {
          mode: 'OUTPUT_VALUES',
          detectorType: DetectorType.CUSTOM,
          customDetectorKey: 'fb_shell_risk',
          findingType: 'tag:Shell-company risk',
          values: [glossaryNorm('hoch (5/12): amtswegig gelöscht')],
          termId: 't-shell',
        }),
        binding('b-nomeaning', {
          detectorType: DetectorType.CUSTOM,
          customDetectorKey: 'fb_trade_category',
          findingType: 'tag:Trade category',
          noMeaning: true,
        }),
      ],
      index: emptyLookupIndex(),
      terms: new Map(),
      loadedAt: Date.now(),
    },
    keys: new Map([
      ['financial-distress', 't-distress'],
      ['email-address', 't-email'],
      ['personal-data', 't-personal'],
      ['contact', 't-contact'],
      ['shell-risk', 't-shell'],
      ['old-distress-key', 't-distress'],
    ]),
    narrower: new Map([['t-personal', ['t-email']]]),
    manualFindings: new Map([['t-distress', new Set(['secrets-s1'])]]),
  });
}

const termCases: Array<{
  name: string;
  matchers: InquiryMatchers;
  expected: string[];
}> = [
  {
    name: 'term via an OUTPUT binding, plus a manual link',
    matchers: {
      ...base,
      matchAllSources: true,
      termKeys: ['financial-distress'],
    },
    expected: ['custom-distress', 'secrets-s1'],
  },
  {
    name: 'a previous key resolves to the same term',
    matchers: {
      ...base,
      matchAllSources: true,
      termKeys: ['old-distress-key'],
    },
    expected: ['custom-distress', 'secrets-s1'],
  },
  {
    name: 'broader term without includeNarrower has no evidence of its own',
    matchers: { ...base, matchAllSources: true, termKeys: ['personal-data'] },
    expected: [],
  },
  {
    name: 'broader term with includeNarrower',
    matchers: {
      ...base,
      matchAllSources: true,
      termKeys: ['personal-data'],
      termsIncludeNarrower: true,
    },
    expected: ['pii-email-s1', 'pii-email-s2'],
  },
  {
    name: 'binding source scope',
    matchers: { ...base, matchAllSources: true, termKeys: ['contact'] },
    expected: ['pii-email-s1'],
  },
  {
    name: 'term AND the source dimension',
    matchers: { ...base, sourceIds: ['s2'], termKeys: ['email-address'] },
    expected: ['pii-email-s2'],
  },
  {
    name: 'term AND the detector dimension',
    matchers: {
      ...base,
      matchAllSources: true,
      detectorTypes: [DetectorType.SECRETS],
      termKeys: ['financial-distress'],
    },
    expected: ['secrets-s1'],
  },
];

describe('term dimension: candidateWhere ⟷ CompiledMatcher', () => {
  beforeEach(primeTerms);

  for (const { name, matchers, expected } of termCases) {
    it(`${name} (exact)`, () => {
      expect(exactInWhere(matchers)).toBe(true);
      expect(bySql(matchers).sort()).toEqual([...expected].sort());
      expect(byMatcher(matchers).sort()).toEqual([...expected].sort());
    });
  }

  it('a value binding makes SQL a superset and the matcher exact', () => {
    const matchers: InquiryMatchers = {
      ...base,
      matchAllSources: true,
      termKeys: ['shell-risk'],
    };
    expect(exactInWhere(matchers)).toBe(false);
    const sql = new Set(bySql(matchers));
    const exact = byMatcher(matchers);
    expect(exact).toEqual(['custom-shell-s2']);
    for (const id of exact) expect(sql.has(id)).toBe(true);
  });

  it('a "no meaning" binding is never evidence', () => {
    const matchers: InquiryMatchers = {
      ...base,
      matchAllSources: true,
      termKeys: ['financial-distress'],
    };
    expect(bySql(matchers)).not.toContain('custom-trade');
  });
});

describe('candidateWhere ⟷ CompiledMatcher conformance', () => {
  describe('no regex dimension: SQL is the answer, so it must be exact', () => {
    for (const { name, matchers } of cases) {
      it(name, () => {
        expect(bySql(matchers).sort()).toEqual(byMatcher(matchers).sort());
      });
    }
  });

  describe('regex dimensions: SQL prefilters, so it must be a superset', () => {
    for (const { name, matchers } of regexCases) {
      it(name, () => {
        const sql = new Set(bySql(matchers));
        for (const id of byMatcher(matchers)) {
          expect(sql.has(id)).toBe(true);
        }
      });
    }
  });

  it('never returns a resolved finding', () => {
    for (const { matchers } of [...cases, ...regexCases]) {
      expect(bySql(matchers)).not.toContain('resolved');
    }
  });

  it('regression: CUSTOM + one key does not return the whole custom set', () => {
    const matchers: InquiryMatchers = {
      ...base,
      matchAllSources: true,
      detectorTypes: [DetectorType.CUSTOM],
      customDetectorKeys: ['fb_distress'],
    };
    expect(bySql(matchers)).toEqual(['custom-distress']);
    expect(byMatcher(matchers)).toEqual(['custom-distress']);
  });
});
