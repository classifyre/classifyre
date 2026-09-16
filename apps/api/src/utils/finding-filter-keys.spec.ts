import { BadRequestException } from '@nestjs/common';
import {
  assertKnownFindingFilterKeys,
  findingFiltersNarrow,
} from './finding-filter-keys';

const rejection = (filters: unknown): Record<string, unknown> => {
  try {
    assertKnownFindingFilterKeys(filters);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<
      string,
      unknown
    >;
  }
  throw new Error('expected a rejection');
};

describe('assertKnownFindingFilterKeys', () => {
  it('accepts every known key and no filters at all', () => {
    expect(() => assertKnownFindingFilterKeys(undefined)).not.toThrow();
    expect(() => assertKnownFindingFilterKeys(null)).not.toThrow();
    expect(() =>
      assertKnownFindingFilterKeys({
        findingType: ['regex:EUID'],
        status: ['OPEN'],
        includeResolved: false,
      }),
    ).not.toThrow();
  });

  it.each([
    ['findingTypes', 'findingType'],
    ['customDetectorKeys', 'customDetectorKey'],
    ['detectorTypes', 'detectorType'],
    ['sourceIds', 'sourceId'],
    ['statuses', 'status'],
    ['severities', 'severity'],
    ['categories', 'category'],
    ['detectionIdentities', 'detectionIdentity'],
    ['FindingType', 'findingType'],
  ])('suggests %s -> %s', (unknown, meant) => {
    const response = rejection({ [unknown]: ['x'] });
    expect(response.unknownKeys).toEqual([unknown]);
    expect(response.suggestions).toEqual({ [unknown]: meant });
    expect(String(response.message)).toContain(`did you mean "${meant}"`);
  });

  it('rejects a key with no plausible match without inventing one', () => {
    const response = rejection({ riskLevel: 'high' });
    expect(response.suggestions).toEqual({});
    expect(response.acceptedKeys).toContain('severity');
  });

  it('rejects an unknown key even when its value is empty', () => {
    // `{ findingTypes: null }` is still a caller who thinks they filtered.
    expect(rejection({ findingTypes: null }).unknownKeys).toEqual([
      'findingTypes',
    ]);
  });

  it('rejects filters that are not an object', () => {
    expect(String(rejection(['findingType']).message)).toMatch(/object/);
    expect(String(rejection('status=OPEN').message)).toMatch(/object/);
  });
});

describe('findingFiltersNarrow', () => {
  it('is false for the incident shape once the typo is gone', () => {
    expect(findingFiltersNarrow({ status: ['OPEN'] })).toBe(false);
    expect(findingFiltersNarrow({ status: 'OPEN' })).toBe(false);
  });

  it('is false for status visibility and subtraction alone', () => {
    expect(findingFiltersNarrow({})).toBe(false);
    expect(findingFiltersNarrow(undefined)).toBe(false);
    expect(
      findingFiltersNarrow({
        status: ['OPEN'],
        includeResolved: true,
        excludeIds: ['f1', 'f2'],
      }),
    ).toBe(false);
  });

  it('ignores keys that are present but empty', () => {
    expect(
      findingFiltersNarrow({
        findingType: [],
        search: '   ',
        sourceId: [''],
        severity: undefined,
      }),
    ).toBe(false);
  });

  it('is true once anything selects a subset', () => {
    expect(findingFiltersNarrow({ findingType: ['regex:EUID'] })).toBe(true);
    expect(findingFiltersNarrow({ search: 'FN 123' })).toBe(true);
    expect(findingFiltersNarrow({ sourceId: 'source-1' })).toBe(true);
    expect(
      findingFiltersNarrow({ firstDetectedAfter: new Date('2026-09-01') }),
    ).toBe(true);
  });
});
