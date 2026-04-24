import { normalizeSourceConfig } from './source-config-normalizer';

describe('normalizeSourceConfig sampling', () => {
  it('preserves fetch_all_until_first_success when provided in sampling', () => {
    const normalized = normalizeSourceConfig('POSTGRESQL', {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      sampling: {
        strategy: 'RANDOM',
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
          rows_per_page: 11,
          fetch_all_until_first_success: true,
        },
      },
    });

    expect((normalized.sampling as Record<string, unknown>)?.strategy).toBe(
      'LATEST',
    );
    expect(
      (normalized.sampling as Record<string, unknown>)?.rows_per_page,
    ).toBe(11);
    expect(
      (normalized.sampling as Record<string, unknown>)
        ?.fetch_all_until_first_success,
    ).toBe(true);
  });

  it('strips legacy limit and max_columns from sampling', () => {
    const normalized = normalizeSourceConfig('POSTGRESQL', {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      sampling: {
        strategy: 'RANDOM',
        limit: 50,
        max_columns: 10,
      },
    });

    expect(
      'limit' in ((normalized.sampling as Record<string, unknown>) ?? {}),
    ).toBe(false);
    expect(
      'max_columns' in ((normalized.sampling as Record<string, unknown>) ?? {}),
    ).toBe(false);
  });

  it('ignores non-boolean fetch_all_until_first_success values', () => {
    const normalized = normalizeSourceConfig('POSTGRESQL', {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      sampling: {
        strategy: 'RANDOM',
        fetch_all_until_first_success: 'true',
      },
    });

    expect(
      'fetch_all_until_first_success' in
        ((normalized.sampling as Record<string, unknown>) ?? {}),
    ).toBe(false);
  });

  it('preserves rows_per_page from sampling and legacy optional.sampling', () => {
    const normalized = normalizeSourceConfig('POSTGRESQL', {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      optional: {
        sampling: {
          rows_per_page: 250,
        },
      },
      sampling: {
        strategy: 'ALL',
        rows_per_page: 500,
      },
    });

    expect((normalized.sampling as Record<string, unknown>)?.strategy).toBe(
      'ALL',
    );
    expect(
      (normalized.sampling as Record<string, unknown>)?.rows_per_page,
    ).toBe(500);
  });
});
