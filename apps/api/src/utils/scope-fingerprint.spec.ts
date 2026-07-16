import { computeScopeFingerprint } from './scope-fingerprint';

describe('computeScopeFingerprint', () => {
  const base = {
    type: 'LOCAL_FOLDER',
    required: { path: '/data' },
    masked: {},
    optional: { scope: { prefix: 'exports/', include_extensions: ['.pdf'] } },
    sampling: { strategy: 'ALL', rows_per_page: 100 },
  };

  it('is stable across repeated calls', () => {
    expect(computeScopeFingerprint('LOCAL_FOLDER', base)).toBe(
      computeScopeFingerprint('LOCAL_FOLDER', base),
    );
  });

  it('ignores key order', () => {
    const reordered = {
      sampling: { rows_per_page: 100, strategy: 'ALL' },
      optional: { scope: { include_extensions: ['.pdf'], prefix: 'exports/' } },
      masked: {},
      required: { path: '/data' },
      type: 'LOCAL_FOLDER',
    };

    expect(computeScopeFingerprint('LOCAL_FOLDER', reordered)).toBe(
      computeScopeFingerprint('LOCAL_FOLDER', base),
    );
  });

  describe('changes that move the scope', () => {
    it('changes when the path changes', () => {
      const narrowed = { ...base, required: { path: '/data/subfolder' } };
      expect(computeScopeFingerprint('LOCAL_FOLDER', narrowed)).not.toBe(
        computeScopeFingerprint('LOCAL_FOLDER', base),
      );
    });

    it('changes when a prefix filter narrows', () => {
      const narrowed = {
        ...base,
        optional: {
          scope: { prefix: 'exports/2026/', include_extensions: ['.pdf'] },
        },
      };
      expect(computeScopeFingerprint('LOCAL_FOLDER', narrowed)).not.toBe(
        computeScopeFingerprint('LOCAL_FOLDER', base),
      );
    });

    it('changes when the file-type allowlist changes', () => {
      const narrowed = {
        ...base,
        optional: {
          scope: { prefix: 'exports/', include_extensions: ['.csv'] },
        },
      };
      expect(computeScopeFingerprint('LOCAL_FOLDER', narrowed)).not.toBe(
        computeScopeFingerprint('LOCAL_FOLDER', base),
      );
    });

    it('changes when the source type changes', () => {
      expect(computeScopeFingerprint('S3', base)).not.toBe(
        computeScopeFingerprint('LOCAL_FOLDER', base),
      );
    });
  });

  describe('changes that leave the scope alone', () => {
    it('ignores the sampling strategy', () => {
      const sampled = {
        ...base,
        sampling: { strategy: 'RANDOM', rows_per_page: 10 },
      };
      expect(computeScopeFingerprint('LOCAL_FOLDER', sampled)).toBe(
        computeScopeFingerprint('LOCAL_FOLDER', base),
      );
    });

    // Adding a detector must not read as a scope move — otherwise every
    // detector change would suppress legitimate retirement for a run.
    it('ignores detectors and custom detectors', () => {
      const withDetectors = {
        ...base,
        detectors: [{ type: 'PII', enabled: true }],
        custom_detectors: ['detector-key-1'],
      };
      expect(computeScopeFingerprint('LOCAL_FOLDER', withDetectors)).toBe(
        computeScopeFingerprint('LOCAL_FOLDER', base),
      );
    });

    // Rotating a credential is not a scope change.
    it('ignores masked credentials', () => {
      const rotated = { ...base, masked: { api_key: 'rotated-secret' } };
      expect(computeScopeFingerprint('LOCAL_FOLDER', rotated)).toBe(
        computeScopeFingerprint('LOCAL_FOLDER', base),
      );
    });

    it('ignores runtime resources', () => {
      const resourced = { ...base, resources: { memory_mb: 4096 } };
      expect(computeScopeFingerprint('LOCAL_FOLDER', resourced)).toBe(
        computeScopeFingerprint('LOCAL_FOLDER', base),
      );
    });
  });

  it('handles a null or absent config without throwing', () => {
    expect(computeScopeFingerprint('LOCAL_FOLDER', null)).toBe(
      computeScopeFingerprint('LOCAL_FOLDER', undefined),
    );
    expect(computeScopeFingerprint('LOCAL_FOLDER', null)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
