import {
  connectionScopeOf,
  connectionStatus,
  isEverything,
  parseScope,
  usernamePart,
} from './connection-scope-rules';

describe('connection scope rules', () => {
  it('parses and deduplicates scope items', () => {
    expect(parseScope(['source:S1', 'asset:a1', 'asset:a1', 'junk:x'])).toEqual(
      {
        sourceIds: ['s1'],
        assetIds: ['a1'],
      },
    );
    expect(isEverything(parseScope(undefined))).toBe(true);
    expect(isEverything(parseScope(['asset:a1']))).toBe(false);
  });

  it('builds a connection’s whole scope from its row, blocks and openings', () => {
    const scope = connectionScopeOf(
      {
        scopeSourceIds: ['s1'],
        scopeAssetIds: [],
        blocks: [{ scopeType: 'ASSET', scopeId: 'a9' }] as never,
      },
      [
        { scopeType: 'SOURCE', scopeId: 's1' },
        { scopeType: 'ASSET', scopeId: 'a2' },
      ],
    );
    expect(scope).toEqual({
      sourceIds: ['s1'],
      assetIds: [],
      blockedSourceIds: [],
      blockedAssetIds: ['a9'],
      openSourceIds: ['s1'],
      openAssetIds: ['a2'],
    });
  });

  it('derives the status, revoked before expired before pending', () => {
    const later = new Date(Date.now() + 1000);
    const past = new Date(Date.now() - 1000);
    expect(
      connectionStatus({
        revokedAt: new Date(),
        expiresAt: past,
        scramStoredKey: null,
      }),
    ).toBe('revoked');
    expect(
      connectionStatus({
        revokedAt: null,
        expiresAt: past,
        scramStoredKey: 'k',
      }),
    ).toBe('expired');
    expect(
      connectionStatus({
        revokedAt: null,
        expiresAt: later,
        scramStoredKey: null,
      }),
    ).toBe('pending');
    expect(
      connectionStatus({
        revokedAt: null,
        expiresAt: later,
        scramStoredKey: 'k',
      }),
    ).toBe('active');
  });

  it('makes user names every tool takes unquoted', () => {
    expect(usernamePart('Power BI – Café')).toBe('power_bi_cafe');
    expect(usernamePart('***')).toBe('');
  });
});
