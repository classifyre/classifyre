import { CompiledMatcher, InquiryMatchers } from './inquiry-matcher';

const base: InquiryMatchers = {
  matchAllSources: false,
  sourceIds: [],
  detectorTypes: [],
  customDetectorKeys: [],
  findingTypes: [],
  findingTypeRegex: [],
  findingValueRegex: [],
};

const finding = (
  over: Partial<{
    sourceId: string;
    detectorType: string;
    findingType: string;
    customDetectorKey: string | null;
  }> = {},
) => ({
  sourceId: over.sourceId ?? 's1',
  detectorType: (over.detectorType ?? 'PII') as never,
  findingType: over.findingType ?? 'email',
  customDetectorKey: over.customDetectorKey ?? null,
});

describe('CompiledMatcher', () => {
  it('matches everything from a source when all lists are empty', () => {
    const m = new CompiledMatcher({ ...base, sourceIds: ['s1'] });
    expect(m.matches(finding())).toBe(true);
    expect(m.matches(finding({ findingType: 'anything' }))).toBe(true);
  });

  it('respects source scoping', () => {
    const m = new CompiledMatcher({ ...base, sourceIds: ['s1'] });
    expect(m.matches(finding({ sourceId: 's2' }))).toBe(false);
  });

  it('matchAllSources ignores sourceIds', () => {
    const m = new CompiledMatcher({ ...base, matchAllSources: true });
    expect(m.matches(finding({ sourceId: 'whatever' }))).toBe(true);
  });

  it('filters by detector type', () => {
    const m = new CompiledMatcher({
      ...base,
      matchAllSources: true,
      detectorTypes: ['SECRETS'] as never,
    });
    expect(m.matches(finding({ detectorType: 'SECRETS' }))).toBe(true);
    expect(m.matches(finding({ detectorType: 'PII' }))).toBe(false);
  });

  it('matches exact finding types', () => {
    const m = new CompiledMatcher({
      ...base,
      matchAllSources: true,
      findingTypes: ['ssn'],
    });
    expect(m.matches(finding({ findingType: 'ssn' }))).toBe(true);
    expect(m.matches(finding({ findingType: 'email' }))).toBe(false);
  });

  it('matches dynamic custom types by regex', () => {
    const m = new CompiledMatcher({
      ...base,
      matchAllSources: true,
      findingTypeRegex: ['^entity:'],
    });
    expect(m.matches(finding({ findingType: 'entity:PERSON' }))).toBe(true);
    expect(m.matches(finding({ findingType: 'classification:toxic' }))).toBe(
      false,
    );
  });

  it('exact OR regex when both provided', () => {
    const m = new CompiledMatcher({
      ...base,
      matchAllSources: true,
      findingTypes: ['ssn'],
      findingTypeRegex: ['^entity:'],
    });
    expect(m.matches(finding({ findingType: 'ssn' }))).toBe(true);
    expect(m.matches(finding({ findingType: 'entity:ORG' }))).toBe(true);
    expect(m.matches(finding({ findingType: 'email' }))).toBe(false);
  });

  it('AND across dimensions (source + detector + type)', () => {
    const m = new CompiledMatcher({
      ...base,
      sourceIds: ['s1'],
      detectorTypes: ['PII'] as never,
      findingTypes: ['email'],
    });
    expect(
      m.matches(
        finding({ sourceId: 's1', detectorType: 'PII', findingType: 'email' }),
      ),
    ).toBe(true);
    expect(
      m.matches(
        finding({ sourceId: 's1', detectorType: 'PII', findingType: 'ssn' }),
      ),
    ).toBe(false);
    expect(
      m.matches(
        finding({ sourceId: 's2', detectorType: 'PII', findingType: 'email' }),
      ),
    ).toBe(false);
  });

  it('matches by custom detector key', () => {
    const m = new CompiledMatcher({
      ...base,
      matchAllSources: true,
      customDetectorKeys: ['my-detector'],
    });
    expect(
      m.matches(
        finding({ detectorType: 'CUSTOM', customDetectorKey: 'my-detector' }),
      ),
    ).toBe(true);
    expect(
      m.matches(
        finding({ detectorType: 'CUSTOM', customDetectorKey: 'other' }),
      ),
    ).toBe(false);
    expect(
      m.matches(finding({ detectorType: 'PII', customDetectorKey: null })),
    ).toBe(false);
  });

  it('ignores invalid regex patterns without throwing', () => {
    const m = new CompiledMatcher({
      ...base,
      matchAllSources: true,
      findingTypeRegex: ['(', '^ok'],
    });
    expect(m.matches(finding({ findingType: 'ok-value' }))).toBe(true);
    expect(m.matches(finding({ findingType: 'nope' }))).toBe(false);
  });
});
