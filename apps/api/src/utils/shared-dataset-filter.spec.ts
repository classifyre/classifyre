import { BadRequestException } from '@nestjs/common';
import { datasetAssetSql, datasetAssetWhere } from './shared-dataset-filter';

/**
 * The Shared tab's filters (DQ §5.12), worked out the way the shared datasets
 * list works out a dataset's state: retired, else blocked, else unavailable,
 * else live.
 */
describe('datasetAssetWhere', () => {
  it('is null without the filters', () => {
    expect(datasetAssetWhere({})).toBeNull();
    expect(datasetAssetSql({})).toBeNull();
  });

  it('reads live as not retired, not blocked and readable', () => {
    expect(datasetAssetWhere({ datasetState: 'live' })).toEqual({
      AND: [
        { sharedDataset: { isNot: null } },
        {
          OR: [
            { governance: null },
            { governance: { status: { not: 'RETIRED' } } },
          ],
        },
        { sharedDataset: { blocks: { none: {} }, unavailableAt: null } },
      ],
    });
  });

  it('puts retired before blocked, and blocked before unavailable', () => {
    expect(datasetAssetWhere({ datasetState: 'retired' })).toEqual({
      AND: [
        { sharedDataset: { isNot: null } },
        { governance: { status: 'RETIRED' } },
      ],
    });
    const unavailable = datasetAssetWhere({ datasetState: 'unavailable' });
    expect(unavailable?.AND).toContainEqual({
      sharedDataset: { blocks: { none: {} }, unavailableAt: { not: null } },
    });
  });

  it('narrows to promoted datasets, with a state or alone', () => {
    expect(datasetAssetWhere({ promoted: true })).toEqual({
      AND: [
        { sharedDataset: { isNot: null } },
        { sharedDataset: { promotedAt: { not: null } } },
      ],
    });
    const sql = datasetAssetSql({ datasetState: 'blocked', promoted: true });
    expect(sql?.sql).toContain('FROM shared_datasets sd');
    expect(sql?.sql).toContain('FROM shared_dataset_blocks b');
    expect(sql?.sql).toContain('sd.promoted_at IS NOT NULL');
  });

  it('refuses a state it does not know', () => {
    expect(() => datasetAssetWhere({ datasetState: 'gone' })).toThrow(
      BadRequestException,
    );
  });
});
