import { normalizeSourceConfig } from './source-config-normalizer';

describe('normalizeSourceConfig sampling', () => {
  it('preserves fetch_all_until_first_success when provided in sampling', () => {
    const normalized = normalizeSourceConfig('POSTGRESQL', {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      sampling: {
        strategy: 'RANDOM',
        limit: 20,
        fetch_all_until_first_success: true,
      },
    });

    expect((normalized.sampling as Record<string, unknown>)?.strategy).toBe(
      'RANDOM',
    );
    expect(
      (normalized.sampling as Record<string, unknown>)
        ?.fetch_all_until_first_success,
    ).toBe(true);
  });

  it('hydrates fetch_all_until_first_success from optional.sampling legacy shape', () => {
    const normalized = normalizeSourceConfig('POSTGRESQL', {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      optional: {
        sampling: {
          mode: 'latest',
          limit: 11,
          fetch_all_until_first_success: true,
        },
      },
    });

    expect((normalized.sampling as Record<string, unknown>)?.strategy).toBe(
      'LATEST',
    );
    expect((normalized.sampling as Record<string, unknown>)?.limit).toBe(11);
    expect(
      (normalized.sampling as Record<string, unknown>)
        ?.fetch_all_until_first_success,
    ).toBe(true);
  });

  it('ignores non-boolean fetch_all_until_first_success values', () => {
    const normalized = normalizeSourceConfig('POSTGRESQL', {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      sampling: {
        strategy: 'RANDOM',
        limit: 10,
        fetch_all_until_first_success: 'true',
      },
    });

    expect(
      'fetch_all_until_first_success' in
        ((normalized.sampling as Record<string, unknown>) ?? {}),
    ).toBe(false);
  });
});
