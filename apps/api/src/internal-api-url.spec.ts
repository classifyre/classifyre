import {
  appendApiPath,
  buildNamespaceApiBaseUrl,
  resolveInternalApiBaseUrl,
} from './internal-api-url';

describe('internal API URLs', () => {
  it('builds a complete namespace URL while preserving a configured path prefix', () => {
    const base = resolveInternalApiBaseUrl('kubernetes', {
      CLASSIFYRE_INTERNAL_API_URL: 'https://api.internal/classifyre/',
    });

    expect(buildNamespaceApiBaseUrl(base, 'namespace-id')).toBe(
      'https://api.internal/classifyre/namespace-id',
    );
  });

  it('does not append the same namespace twice', () => {
    expect(
      buildNamespaceApiBaseUrl(
        'https://api.internal/classifyre/namespace-id',
        'namespace-id',
      ),
    ).toBe('https://api.internal/classifyre/namespace-id');
  });

  it('appends endpoint paths without dropping the namespace', () => {
    expect(
      appendApiPath(
        'https://api.internal/classifyre/namespace-id',
        '/runners/runner-id/assets/discover',
      ),
    ).toBe(
      'https://api.internal/classifyre/namespace-id/runners/runner-id/assets/discover',
    );
  });

  it('fails before launching a job without a namespace', () => {
    expect(() =>
      buildNamespaceApiBaseUrl('https://api.internal', undefined),
    ).toThrow('without a namespace ID');
  });
});
