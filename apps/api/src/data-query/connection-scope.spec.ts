import { connectionAllows, type ConnectionScope } from './connection-scope';

const table = { assetId: 'a1', sourceId: 's1' };
const base: ConnectionScope = {
  sourceIds: [],
  assetIds: [],
  blockedSourceIds: [],
  blockedAssetIds: [],
  openSourceIds: [],
  openAssetIds: [],
};

describe('connectionAllows', () => {
  it('reaches nothing the workspace has not opened', () => {
    expect(connectionAllows(base, table)).toBe(false);
  });

  it('opens a table by itself or through its source', () => {
    expect(connectionAllows({ ...base, openAssetIds: ['a1'] }, table)).toBe(
      true,
    );
    expect(connectionAllows({ ...base, openSourceIds: ['s1'] }, table)).toBe(
      true,
    );
  });

  it('narrows to the connection scope and honours blocks', () => {
    const open = { ...base, openSourceIds: ['s1'] };
    expect(connectionAllows({ ...open, assetIds: ['a2'] }, table)).toBe(false);
    expect(connectionAllows({ ...open, sourceIds: ['s1'] }, table)).toBe(true);
    expect(connectionAllows({ ...open, blockedAssetIds: ['a1'] }, table)).toBe(
      false,
    );
  });
});
