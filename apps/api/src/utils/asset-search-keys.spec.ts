import { BadRequestException } from '@nestjs/common';
import { assertKnownAssetSearchKeys } from './asset-search-keys';

describe('assertKnownAssetSearchKeys', () => {
  it('accepts the documented shape', () => {
    expect(() =>
      assertKnownAssetSearchKeys({
        assets: { search: 'Oldenburg', status: ['NEW'] },
        findings: { customDetectorKey: ['de_region_trajectory'] },
        page: { limit: 10 },
        options: { includeAssetsWithoutFindings: true },
      }),
    ).not.toThrow();
  });

  // The findings endpoint takes { filters, page }; sending that shape here
  // returned every asset in the namespace with a 200.
  it('rejects the findings request shape instead of returning everything', () => {
    expect(() =>
      assertKnownAssetSearchKeys({ filters: { search: 'x' }, page: {} }),
    ).toThrow(BadRequestException);
    try {
      assertKnownAssetSearchKeys({ filters: {} });
    } catch (error) {
      expect((error as BadRequestException).message).toContain('filters');
      expect((error as BadRequestException).message).toContain(
        'it returns everything',
      );
    }
  });

  it('rejects an unknown asset filter and suggests the right key', () => {
    try {
      assertKnownAssetSearchKeys({ assets: { sourceIds: ['a'] } });
      fail('expected a BadRequestException');
    } catch (error) {
      expect((error as BadRequestException).message).toContain(
        'sourceIds (did you mean sourceId?)',
      );
    }
  });

  it('ignores a body that is not an object', () => {
    expect(() => assertKnownAssetSearchKeys(undefined)).not.toThrow();
    expect(() => assertKnownAssetSearchKeys([1, 2])).not.toThrow();
  });
});
