import {
  CUSTOM_KEY_PREFIX,
  configuredDetectorKeysFromConfig,
  describeDetectorKey,
  findingDetectorConfigKey,
  orphanedDetectorWhere,
} from './detector-config-keys';
import { DetectorType } from '@prisma/client';

describe('configuredDetectorKeysFromConfig', () => {
  it('reads built-in and custom entries from a detectors array', () => {
    const parsed = configuredDetectorKeysFromConfig({
      detectors: [
        { type: 'PII', enabled: true },
        { type: 'CUSTOM', enabled: true, custom_detector_key: ' Tasq ' },
        { type: 'CUSTOM', enabled: true, config: { custom_detector_key: 'old-nested' } },
        { type: 'YARA', enabled: false },
        { type: '', enabled: true },
        null,
      ],
      custom_detectors: ['cd-1', 42, null],
    });

    expect(parsed?.customOnly).toBe(false);
    expect(parsed?.keys).toEqual(
      new Set(['PII', `${CUSTOM_KEY_PREFIX}Tasq`, `${CUSTOM_KEY_PREFIX}old-nested`]),
    );
    expect(parsed?.legacyCustomIds).toEqual(['cd-1']);
  });

  it('reads a CUSTOM source carrying only custom_detectors ids', () => {
    // The notebook layout: detectors absent, detectors named by row id.
    const parsed = configuredDetectorKeysFromConfig({
      custom_detectors: ['cd-1', 'cd-2'],
    });

    expect(parsed?.customOnly).toBe(true);
    expect(parsed?.keys).toEqual(new Set());
    expect(parsed?.legacyCustomIds).toEqual(['cd-1', 'cd-2']);
  });

  it.each([
    ['empty config', {}],
    ['null config', null],
    ['non-array detectors and no ids', { detectors: 'PII' }],
    ['empty custom_detectors', { custom_detectors: [] }],
    ['custom_detectors with no string ids', { custom_detectors: [42, null] }],
  ])('returns null (unknown, never empty) for %s', (_label, config) => {
    expect(configuredDetectorKeysFromConfig(config)).toBeNull();
  });
});

describe('findingDetectorConfigKey', () => {
  it('keys CUSTOM findings by their detector key', () => {
    expect(
      findingDetectorConfigKey({
        detectorType: 'CUSTOM',
        customDetectorKey: 'tasq',
      }),
    ).toBe(`${CUSTOM_KEY_PREFIX}tasq`);
  });

  it('returns null for a CUSTOM finding without a key', () => {
    expect(
      findingDetectorConfigKey({ detectorType: 'CUSTOM', customDetectorKey: null }),
    ).toBeNull();
  });

  it('keys built-in findings by detector type', () => {
    expect(
      findingDetectorConfigKey({ detectorType: 'PII', customDetectorKey: null }),
    ).toBe('PII');
  });
});

describe('describeDetectorKey', () => {
  it('names custom and built-in keys', () => {
    expect(describeDetectorKey(`${CUSTOM_KEY_PREFIX}tasq`)).toBe(
      'custom detector "tasq"',
    );
    expect(describeDetectorKey('PII')).toBe('built-in PII');
  });
});

describe('orphanedDetectorWhere', () => {
  it('selects findings outside the configured set', () => {
    const [nonCustom, custom] = orphanedDetectorWhere(
      new Set(['PII', `${CUSTOM_KEY_PREFIX}tasq`]),
    );

    expect(nonCustom).toEqual({
      detectorType: { notIn: ['PII', DetectorType.CUSTOM] },
    });
    expect(custom).toEqual({
      detectorType: DetectorType.CUSTOM,
      customDetectorKey: { not: null, notIn: ['tasq'] },
    });
  });

  it('is a superset for a custom-only set: SQL still selects non-CUSTOM rows', () => {
    // Built-ins are not configurable on a custom-only source, so the SQL
    // half cannot exclude them — the in-memory re-check (customOnly) must.
    const [nonCustom] = orphanedDetectorWhere(
      new Set([`${CUSTOM_KEY_PREFIX}tasq`]),
    );

    expect(nonCustom).toEqual({
      detectorType: { notIn: [DetectorType.CUSTOM] },
    });
  });
});
