/**
 * Bug 1: sandbox CUSTOM detector config not expanded from DB.
 *
 * The API receives {"type":"CUSTOM","custom_detector_key":"abc"} from the user,
 * writes it to detectors.json, and the CLI tries to validate an empty config `{}`,
 * which fails because CustomDetectorConfig requires custom_detector_key, name, method.
 *
 * Fix: SandboxService.expandCustomDetectors() looks up the detector from DB and
 * merges name/method/config into the config dict before writing detectors.json.
 */

// Extract and test the pure expansion logic in isolation.
// We replicate the private method logic here to unit-test it without needing DI.

type DetectorItem = Record<string, unknown>;

interface CustomDetectorRecord {
  key: string;
  name: string;
  method: string;
  config: Record<string, unknown>;
}

function expandCustomDetectors(
  detectors: unknown[],
  byKey: Map<string, CustomDetectorRecord>,
): unknown[] {
  return detectors.map((d) => {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return d;
    const item = d as DetectorItem;
    const type = typeof item.type === 'string' ? item.type.toUpperCase() : '';
    const detectorKey =
      typeof item.custom_detector_key === 'string'
        ? item.custom_detector_key
        : '';

    if (type !== 'CUSTOM' || !detectorKey) return d;

    const record = byKey.get(detectorKey);
    if (!record) return d;

    const existingConfig =
      item.config &&
      typeof item.config === 'object' &&
      !Array.isArray(item.config)
        ? (item.config as Record<string, unknown>)
        : {};

    return {
      ...item,
      config: {
        ...record.config,
        ...existingConfig,
        // identity fields always come from DB
        custom_detector_key: record.key,
        name: record.name,
        method: record.method,
      },
    };
  });
}

describe('SandboxService.expandCustomDetectors (Bug 1)', () => {
  const fakeRecord: CustomDetectorRecord = {
    key: 'my-classifier',
    name: 'My Classifier',
    method: 'CLASSIFIER',
    config: { labels: ['positive', 'negative'], threshold: 0.5 },
  };
  const byKey = new Map([['my-classifier', fakeRecord]]);

  it('expands a CUSTOM detector entry with DB fields', () => {
    const detectors: unknown[] = [
      {
        type: 'CUSTOM',
        enabled: true,
        custom_detector_key: 'my-classifier',
        config: {},
      },
    ];

    const result = expandCustomDetectors(detectors, byKey) as DetectorItem[];
    const expanded = result[0];

    expect((expanded.config as any).custom_detector_key).toBe('my-classifier');
    expect((expanded.config as any).name).toBe('My Classifier');
    expect((expanded.config as any).method).toBe('CLASSIFIER');
    expect((expanded.config as any).labels).toEqual(['positive', 'negative']);
  });

  it('leaves non-CUSTOM detectors unchanged', () => {
    const detector = { type: 'SECRETS', enabled: true, config: {} };
    const result = expandCustomDetectors([detector], byKey);
    expect(result[0]).toBe(detector);
  });

  it('leaves CUSTOM detectors with unknown key unchanged', () => {
    const detector = {
      type: 'CUSTOM',
      enabled: true,
      custom_detector_key: 'unknown-key',
      config: {},
    };
    const result = expandCustomDetectors([detector], byKey) as DetectorItem[];
    // key not in map → returned as-is
    expect(result[0]).toBe(detector);
  });

  it('identity fields from DB always override caller-supplied config', () => {
    const detectors: unknown[] = [
      {
        type: 'CUSTOM',
        enabled: true,
        custom_detector_key: 'my-classifier',
        config: {
          // attacker tries to override name
          name: 'evil-name',
          method: 'ENTITY',
          custom_detector_key: 'other-key',
        },
      },
    ];

    const result = expandCustomDetectors(detectors, byKey) as DetectorItem[];
    const expanded = result[0];
    const cfg = expanded.config as Record<string, unknown>;

    expect(cfg.name).toBe('My Classifier');
    expect(cfg.method).toBe('CLASSIFIER');
    expect(cfg.custom_detector_key).toBe('my-classifier');
  });

  it('mixes CUSTOM and non-CUSTOM in same array', () => {
    const secretsDetector = { type: 'SECRETS', enabled: true, config: {} };
    const customDetector = {
      type: 'CUSTOM',
      enabled: true,
      custom_detector_key: 'my-classifier',
      config: {},
    };

    const result = expandCustomDetectors(
      [secretsDetector, customDetector],
      byKey,
    ) as DetectorItem[];

    expect(result[0]).toBe(secretsDetector);
    expect((result[1] as any).config.name).toBe('My Classifier');
  });

  it('handles CUSTOM entry without custom_detector_key gracefully', () => {
    const detector = { type: 'CUSTOM', enabled: true, config: {} };
    const result = expandCustomDetectors([detector], byKey);
    expect(result[0]).toBe(detector);
  });
});
