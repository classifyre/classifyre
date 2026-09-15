import {
  buildRetirePlan,
  candidatePageSql,
  outOfScopeReason,
  planNeedsWalk,
  resolutionReasonFor,
} from './retire-out-of-scope.plan';

const detector = (pipelineSchema: Record<string, unknown>) => ({
  id: 'det-1',
  key: 'at_company_ids',
  name: 'AT company ids',
  version: 3,
  pipelineSchema,
});

// The live detector that motivated this, after it was narrowed.
const narrowedRegex = detector({
  type: 'REGEX',
  scope: { asset_kinds: [' Record ', 'document', 'record'] },
  patterns: {
    LEI: { pattern: '[A-Z0-9]{20}' },
    AT_FIRMENBUCHNUMMER: { pattern: 'FN ?\\d+[a-z]' },
  },
});

describe('buildRetirePlan', () => {
  it('reads kinds the way the scanner compares them, and the current pattern names', () => {
    const plan = buildRetirePlan(narrowedRegex);

    expect(plan).toMatchObject({
      detectorId: 'det-1',
      customDetectorKey: 'at_company_ids',
      detectorVersion: 3,
      method: 'REGEX',
      assetKinds: ['record', 'document'],
      patternKeys: ['LEI', 'AT_FIRMENBUCHNUMMER'],
      sourceIds: null,
    });
  });

  it('treats an absent or empty kind list as unscoped, not as "no kind allowed"', () => {
    expect(buildRetirePlan(detector({ type: 'REGEX' })).assetKinds).toBeNull();
    expect(
      buildRetirePlan(detector({ type: 'LLM', scope: { asset_kinds: [] } }))
        .assetKinds,
    ).toBeNull();
  });

  it('has no current patterns for a detector that is not REGEX', () => {
    const plan = buildRetirePlan(
      detector({ type: 'LLM', patterns: { LEI: {} }, labels: [] }),
    );
    expect(plan.patternKeys).toEqual([]);
  });

  it('reports what it cannot prove instead of guessing', () => {
    const plan = buildRetirePlan(
      detector({
        type: 'GLINER2',
        scope: {
          asset_kinds: ['table'],
          metadata: { is_financial: true },
          content_types: ['application/pdf'],
        },
      }),
    );
    expect(plan.notProvable.map((d) => d.dimension)).toEqual([
      'scope.metadata',
      'scope.content_types',
      'entities',
    ]);
  });

  it('dedupes source ids and reads an empty list as every source', () => {
    expect(
      buildRetirePlan(narrowedRegex, ['s1', 's1', 's2']).sourceIds,
    ).toEqual(['s1', 's2']);
    expect(buildRetirePlan(narrowedRegex, []).sourceIds).toBeNull();
  });
});

describe('outOfScopeReason', () => {
  const plan = buildRetirePlan(narrowedRegex);

  it('retires a finding on an asset kind the scope no longer covers', () => {
    expect(
      outOfScopeReason(plan, {
        findingType: 'regex:AT_FIRMENBUCHNUMMER',
        assetKind: 'page',
      }),
    ).toBe('asset_kind:page');
  });

  it('retires a finding of a pattern that was removed', () => {
    expect(
      outOfScopeReason(plan, {
        findingType: 'regex:EUID',
        assetKind: 'record',
      }),
    ).toBe('pattern_removed:EUID');
  });

  it('counts a finding that is out on both counts once, under its kind', () => {
    expect(
      outOfScopeReason(plan, { findingType: 'regex:EUID', assetKind: 'table' }),
    ).toBe('asset_kind:table');
  });

  it('leaves an in-scope finding of a current pattern alone', () => {
    expect(
      outOfScopeReason(plan, {
        findingType: 'regex:LEI',
        assetKind: 'document',
      }),
    ).toBeNull();
  });

  it('keys a pattern by its full name, colons included', () => {
    const colon = buildRetirePlan(
      detector({ type: 'REGEX', patterns: { 'AT:FN': {} } }),
    );
    expect(
      outOfScopeReason(colon, { findingType: 'regex:AT:FN', assetKind: 'x' }),
    ).toBeNull();
    expect(
      outOfScopeReason(colon, { findingType: 'regex:AT', assetKind: 'x' }),
    ).toBe('pattern_removed:AT');
  });

  it('retires stale regex findings of a detector switched to another method', () => {
    const llm = buildRetirePlan(detector({ type: 'LLM' }));
    expect(
      outOfScopeReason(llm, { findingType: 'regex:LEI', assetKind: 'record' }),
    ).toBe('pattern_removed:LEI');
    // Entity labels are not provable, so they are never retired here.
    expect(
      outOfScopeReason(llm, {
        findingType: 'entity:company',
        assetKind: 'record',
      }),
    ).toBeNull();
  });
});

describe('candidatePageSql', () => {
  it('bounds the page by physical blocks and binds every value', () => {
    const plan = buildRetirePlan(narrowedRegex, ['s1']);
    const sql = candidatePageSql(plan, 8192, 16384);

    expect(sql.sql).toContain('f.ctid >= ');
    expect(sql.sql).toContain('::tid AND f.ctid < ');
    expect(sql.sql).toContain('lower(btrim(a.asset_type)) <> ALL(');
    expect(sql.sql).toContain("f.finding_type LIKE 'regex:%'");
    expect(sql.sql).toContain('f.source_id = ANY(');
    expect(sql.sql).toContain(`f.status = 'OPEN'::"FindingStatus"`);
    expect(sql.values).toEqual([
      '(8192,0)',
      '(16384,0)',
      'at_company_ids',
      ['s1'],
      ['record', 'document'],
      ['LEI', 'AT_FIRMENBUCHNUMMER'],
    ]);
  });

  it('drops the kind branch for an unscoped detector', () => {
    const sql = candidatePageSql(
      buildRetirePlan(detector({ type: 'REGEX', patterns: { LEI: {} } })),
      0,
      8192,
    );
    expect(sql.sql).not.toContain('asset_type) <> ALL');
    expect(sql.sql).not.toContain('source_id = ANY');
  });
});

describe('planNeedsWalk', () => {
  it('walks for a kind scope or a REGEX detector, probes otherwise', () => {
    expect(planNeedsWalk(buildRetirePlan(narrowedRegex))).toBe(true);
    expect(
      planNeedsWalk(
        buildRetirePlan(
          detector({ type: 'LLM', scope: { asset_kinds: ['table'] } }),
        ),
      ),
    ).toBe(true);
    expect(planNeedsWalk(buildRetirePlan(detector({ type: 'LLM' })))).toBe(
      false,
    );
  });
});

describe('resolutionReasonFor', () => {
  it('says which detector and why, in words', () => {
    const plan = buildRetirePlan(narrowedRegex);
    expect(resolutionReasonFor(plan, 'asset_kind:page')).toBe(
      'Out of scope for at_company_ids: asset kind "page" is outside its scope',
    );
    expect(resolutionReasonFor(plan, 'pattern_removed:AT:FN')).toBe(
      'Out of scope for at_company_ids: pattern "AT:FN" was removed',
    );
  });
});
