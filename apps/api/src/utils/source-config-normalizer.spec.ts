import { normalizeSourceConfig } from './source-config-normalizer';

describe('normalizeSourceConfig sampling', () => {
  it('accepts the AUTOMATIC strategy', () => {
    const normalized = normalizeSourceConfig('POSTGRESQL', {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      sampling: { strategy: 'AUTOMATIC' },
    });

    expect((normalized.sampling as Record<string, unknown>)?.strategy).toBe(
      'AUTOMATIC',
    );
  });

  it('defaults to AUTOMATIC when no strategy is provided', () => {
    const normalized = normalizeSourceConfig('POSTGRESQL', {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      sampling: {},
    });

    expect((normalized.sampling as Record<string, unknown>)?.strategy).toBe(
      'AUTOMATIC',
    );
  });

  it('strips fetch_all_until_first_success from sampling', () => {
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
      'fetch_all_until_first_success' in
        ((normalized.sampling as Record<string, unknown>) ?? {}),
    ).toBe(false);
  });

  it('strips fetch_all_until_first_success from legacy optional.sampling', () => {
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
      'fetch_all_until_first_success' in
        ((normalized.sampling as Record<string, unknown>) ?? {}),
    ).toBe(false);
  });

  it('preserves enable_ocr from sampling and legacy optional.sampling', () => {
    const normalized = normalizeSourceConfig('POSTGRESQL', {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      optional: {
        sampling: {
          enable_ocr: false,
        },
      },
      sampling: {
        strategy: 'ALL',
        enable_ocr: true,
      },
    });

    expect((normalized.sampling as Record<string, unknown>)?.strategy).toBe(
      'ALL',
    );
    expect((normalized.sampling as Record<string, unknown>)?.enable_ocr).toBe(
      true,
    );
  });

  it('preserves enable_transcription from sampling and legacy optional.sampling', () => {
    const normalized = normalizeSourceConfig('POSTGRESQL', {
      type: 'POSTGRESQL',
      required: { host: 'db.local', port: 5432 },
      optional: {
        sampling: {
          enable_transcription: false,
        },
      },
      sampling: {
        strategy: 'ALL',
        enable_transcription: true,
      },
    });

    expect(
      (normalized.sampling as Record<string, unknown>)?.enable_transcription,
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
