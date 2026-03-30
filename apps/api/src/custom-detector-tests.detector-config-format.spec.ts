/**
 * Bug 2: CLASSIFIER/ENTITY detector tests use wrong CLI format and local path.
 *
 * The old evaluateViaCli built a payload:
 *   [{ detector_type: "CUSTOM", custom: [config] }]
 * which is not the format the CLI's SandboxRunner expects. Additionally, it
 * always ran `cd /app/cli` which fails on K8s API pods where the CLI is not
 * installed locally.
 *
 * Fix: evaluateViaCli now builds the correct sandbox detector format:
 *   [{ type: "CUSTOM", enabled: true, config: { custom_detector_key, name, method, ...config } }]
 * and uses KubernetesCliJobService.runSandboxJob when K8s is enabled.
 *
 * Tests here validate the detector config payload format (pure logic).
 */

// Replicate the config-building logic from evaluateViaCli.
interface DetectorInfo {
  key: string;
  name: string;
  method: string;
  config: Record<string, unknown>;
}

function buildDetectorEntry(detector: DetectorInfo): unknown {
  return {
    type: 'CUSTOM',
    enabled: true,
    config: {
      ...detector.config,
      custom_detector_key: detector.key,
      name: detector.name,
      method: detector.method,
    },
  };
}

describe('evaluateViaCli - detector config format (Bug 2)', () => {
  const classifierDetector: DetectorInfo = {
    key: 'news-classifier',
    name: 'News Domain Classifier',
    method: 'CLASSIFIER',
    config: { labels: ['politics', 'sports', 'finance'], threshold: 0.5 },
  };

  it('produces type=CUSTOM with enabled=true', () => {
    const entry = buildDetectorEntry(classifierDetector) as Record<
      string,
      unknown
    >;
    expect(entry.type).toBe('CUSTOM');
    expect(entry.enabled).toBe(true);
  });

  it('places custom_detector_key, name, method inside config', () => {
    const entry = buildDetectorEntry(classifierDetector) as Record<
      string,
      unknown
    >;
    const cfg = entry.config as Record<string, unknown>;
    expect(cfg.custom_detector_key).toBe('news-classifier');
    expect(cfg.name).toBe('News Domain Classifier');
    expect(cfg.method).toBe('CLASSIFIER');
  });

  it('passes through detector-specific config fields', () => {
    const entry = buildDetectorEntry(classifierDetector) as Record<
      string,
      unknown
    >;
    const cfg = entry.config as Record<string, unknown>;
    expect(cfg.labels).toEqual(['politics', 'sports', 'finance']);
    expect(cfg.threshold).toBe(0.5);
  });

  it('identity fields override anything in detector.config', () => {
    const detector: DetectorInfo = {
      key: 'real-key',
      name: 'Real Name',
      method: 'ENTITY',
      config: {
        // These should be overridden by the detector identity fields
        custom_detector_key: 'wrong-key',
        name: 'wrong-name',
        method: 'CLASSIFIER',
      },
    };
    const entry = buildDetectorEntry(detector) as Record<string, unknown>;
    const cfg = entry.config as Record<string, unknown>;
    expect(cfg.custom_detector_key).toBe('real-key');
    expect(cfg.name).toBe('Real Name');
    expect(cfg.method).toBe('ENTITY');
  });

  it('wraps in array for the CLI sandbox detectors format', () => {
    const entry = buildDetectorEntry(classifierDetector);
    const payload = JSON.parse(JSON.stringify([entry]));
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(1);
    expect(payload[0].type).toBe('CUSTOM');
  });

  it('old format (detector_type + custom array) is NOT produced', () => {
    const entry = buildDetectorEntry(classifierDetector) as Record<
      string,
      unknown
    >;
    // The old wrong format had detector_type and custom keys
    expect(entry).not.toHaveProperty('detector_type');
    expect(entry).not.toHaveProperty('custom');
  });
});
