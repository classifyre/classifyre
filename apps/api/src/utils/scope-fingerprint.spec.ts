import {
  computeSamplingFingerprint,
  computeScopeFingerprint,
  type SamplingFingerprintDetector,
} from './scope-fingerprint';

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

describe('augmentation', () => {
  const base = {
    type: 'LOCAL_FOLDER',
    required: { path: '/data' },
    masked: {},
    sampling: { strategy: 'ALL', rows_per_page: 100 },
  };

  it('ignores the augmentation notebook', () => {
    const augmented = {
      ...base,
      augmentation: {
        enabled: true,
        notebook: {
          revision: 7,
          cells: [{ id: 'nb', type: 'code', source: 'def augment(a): pass' }],
        },
      },
    };
    expect(computeScopeFingerprint('LOCAL_FOLDER', augmented)).toBe(
      computeScopeFingerprint('LOCAL_FOLDER', base),
    );
  });
});

describe('computeSamplingFingerprint', () => {
  const base = {
    type: 'LOCAL_FOLDER',
    required: { path: '/data' },
    masked: { token: 'enc:v1:aaaa' },
    optional: { scope: { prefix: 'exports/' } },
    sampling: { strategy: 'AUTOMATIC', rows_per_page: 100 },
    detectors: [
      { type: 'SECRETS', enabled: true },
      { type: 'CUSTOM', enabled: true, custom_detector_key: 'contracts' },
    ],
  };
  const detector: SamplingFingerprintDetector = {
    key: 'contracts',
    active: true,
    definition: { type: 'REGEX', patterns: ['NDA-\\d+'] },
    trainedAt: null,
    files: [{ name: 'terms.txt', hash: 'h1' }],
  };
  const fingerprint = (
    config: unknown = base,
    detectors: SamplingFingerprintDetector[] = [detector],
  ) => computeSamplingFingerprint('LOCAL_FOLDER', config, detectors);

  it('is stable, whatever the key or detector order', () => {
    const other: SamplingFingerprintDetector = { ...detector, key: 'invoices' };
    const reordered = {
      detectors: base.detectors,
      sampling: { rows_per_page: 100, strategy: 'AUTOMATIC' },
      optional: base.optional,
      masked: base.masked,
      required: base.required,
      type: 'LOCAL_FOLDER',
    };
    expect(fingerprint(reordered, [other, detector])).toBe(
      fingerprint(base, [detector, other]),
    );
  });

  it('does not change when a credential is rotated', () => {
    expect(fingerprint({ ...base, masked: { token: 'enc:v1:bbbb' } })).toBe(
      fingerprint(),
    );
    const withSecrets = (value: string) => ({
      ...base,
      augmentation: { enabled: true, secrets: { api: value } },
    });
    expect(fingerprint(withSecrets('enc:one'))).toBe(
      fingerprint(withSecrets('enc:two')),
    );
  });

  it.each([
    ['the scope', { ...base, optional: { scope: { prefix: 'other/' } } }],
    ['the path', { ...base, required: { path: '/elsewhere' } }],
    [
      'the window size',
      { ...base, sampling: { strategy: 'AUTOMATIC', rows_per_page: 50 } },
    ],
    [
      'a detector switched off',
      {
        ...base,
        detectors: [
          { type: 'SECRETS', enabled: false },
          { type: 'CUSTOM', enabled: true, custom_detector_key: 'contracts' },
        ],
      },
    ],
    [
      'a detector added',
      {
        ...base,
        detectors: [...base.detectors, { type: 'PII', enabled: true }],
      },
    ],
  ])('changes when %s changes', (_label, config) => {
    expect(fingerprint(config)).not.toBe(fingerprint());
  });

  it.each([
    ['edited', { ...detector, definition: { type: 'REGEX', patterns: ['X'] } }],
    ['retrained', { ...detector, trainedAt: '2026-10-08T10:00:00.000Z' }],
    ['deactivated', { ...detector, active: false }],
    [
      'given a different file',
      { ...detector, files: [{ name: 'terms.txt', hash: 'h2' }] },
    ],
  ])('changes when a custom detector it uses is %s', (_label, changed) => {
    expect(fingerprint(base, [changed])).not.toBe(fingerprint());
  });

  it('changes when a custom detector it uses is deleted', () => {
    expect(fingerprint(base, [])).not.toBe(fingerprint());
  });

  it('ignores a secret inside a detector definition', () => {
    const withSecret = (value: string) => ({
      ...detector,
      definition: { type: 'CODE_DETECTOR', secrets: { key: value } },
    });
    expect(fingerprint(base, [withSecret('one')])).toBe(
      fingerprint(base, [withSecret('two')]),
    );
  });
});
