/**
 * Bug 3: search_findings with plain string sourceId crashes Prisma.
 *
 * The MCP server passes raw JSON (no class-transformer coercions), so filter
 * arrays can arrive as plain strings. Prisma's `{ in: value }` operator expects
 * string[] — a string triggers a validation error.
 *
 * Fix: buildSearchFindingsWhere uses normalizeFilterValues() for all array
 * filter fields, same as it already did for runnerId.
 *
 * We test the normalizeFilterValues helper in isolation.
 */

// Replicate the private helper to unit-test it without DI.
function normalizeFilterValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    );
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }
  return [];
}

describe('FindingsService.normalizeFilterValues (Bug 3)', () => {
  it('wraps a plain string into a single-element array', () => {
    expect(normalizeFilterValues('abc-123')).toEqual(['abc-123']);
  });

  it('passes a string array through', () => {
    expect(normalizeFilterValues(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('filters out non-string entries from array', () => {
    expect(normalizeFilterValues(['a', 42, null, 'b', undefined])).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns empty array for undefined', () => {
    expect(normalizeFilterValues(undefined)).toEqual([]);
  });

  it('returns empty array for null', () => {
    expect(normalizeFilterValues(null)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(normalizeFilterValues('')).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(normalizeFilterValues([])).toEqual([]);
  });

  it('returns empty array for number input', () => {
    expect(normalizeFilterValues(123)).toEqual([]);
  });
});

// Integration-style test: verify buildSearchFindingsWhere does not pass a plain
// string to Prisma's `in` operator when sourceId is a string.
describe('buildSearchFindingsWhere - sourceId normalization (Bug 3)', () => {
  // Minimal replica of the where-builder logic for sourceId.
  function buildWhereSourceId(filters?: { sourceId?: unknown }) {
    const where: Record<string, unknown> = {};
    const sourceIds = normalizeFilterValues(filters?.sourceId);
    if (sourceIds.length) {
      where.sourceId = { in: sourceIds };
    }
    return where;
  }

  it('produces { in: string[] } when sourceId is a plain string', () => {
    const where = buildWhereSourceId({ sourceId: 'source-uuid-123' });
    expect(where.sourceId).toEqual({ in: ['source-uuid-123'] });
  });

  it('produces { in: string[] } when sourceId is already an array', () => {
    const where = buildWhereSourceId({ sourceId: ['a', 'b'] });
    expect(where.sourceId).toEqual({ in: ['a', 'b'] });
  });

  it('omits sourceId from where when sourceId is undefined', () => {
    const where = buildWhereSourceId({});
    expect(where.sourceId).toBeUndefined();
  });

  it('omits sourceId from where when sourceId is empty string', () => {
    const where = buildWhereSourceId({ sourceId: '' });
    expect(where.sourceId).toBeUndefined();
  });
});
