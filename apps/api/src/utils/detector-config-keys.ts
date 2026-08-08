/**
 * Detector identity, as a comparison key shared by the two sides of the same
 * question: "which detectors does this config ask for?" and "which detector
 * produced this finding?".
 *
 * The answer decides whether a finding is orphaned by a config change — which
 * is what `AssetService.resolveRemovedDetectorFindings` acts on at the end of
 * every run, and what the autopilot needs to price a config change BEFORE it
 * makes one. Those two must agree exactly, so the logic lives here rather than
 * being written twice.
 *
 * Keys are `"<DETECTOR_TYPE>"` for built-ins and `"CUSTOM::<key>"` for custom
 * detectors.
 */

export const CUSTOM_KEY_PREFIX = 'CUSTOM::';

/** The comparison key for a finding, or null when its detector is unidentifiable. */
export function findingDetectorConfigKey(finding: {
  detectorType: string;
  customDetectorKey: string | null;
}): string | null {
  if (finding.detectorType === 'CUSTOM') {
    return finding.customDetectorKey
      ? `${CUSTOM_KEY_PREFIX}${finding.customDetectorKey}`
      : null;
  }
  return finding.detectorType;
}

/**
 * The detector identities a source config asks for.
 *
 * Returns null when the config has no readable `detectors` array — callers must
 * treat that as "unknown", never as "empty", or a config shape this code does
 * not understand would look like a source that detects nothing.
 *
 * `legacyCustomIds` are custom-detector *row ids* from the older
 * `config.custom_detectors` shape; resolving those to keys needs the database,
 * so it stays with the caller.
 */
export function configuredDetectorKeysFromConfig(
  config: unknown,
): { keys: Set<string>; legacyCustomIds: string[] } | null {
  const recipe = (config ?? {}) as Record<string, any>;
  const detectors = recipe.detectors;
  if (!Array.isArray(detectors)) return null;

  const keys = new Set<string>();
  for (const entry of detectors) {
    if (!entry || typeof entry !== 'object' || entry.enabled === false) {
      continue;
    }
    const type = String(entry.type ?? '')
      .trim()
      .toUpperCase();
    if (!type) continue;
    if (type === 'CUSTOM') {
      // Key lives at the top level in current configs; older shapes nested it
      // under config.
      const key =
        typeof entry.custom_detector_key === 'string'
          ? entry.custom_detector_key.trim()
          : typeof entry.config?.custom_detector_key === 'string'
            ? entry.config.custom_detector_key.trim()
            : '';
      if (key) keys.add(`${CUSTOM_KEY_PREFIX}${key}`);
    } else {
      keys.add(type);
    }
  }

  const legacyCustomIds = Array.isArray(recipe.custom_detectors)
    ? recipe.custom_detectors.filter(
        (id: unknown): id is string => typeof id === 'string',
      )
    : [];

  return { keys, legacyCustomIds };
}

/** Human-readable form of a comparison key, for operator- and agent-facing text. */
export function describeDetectorKey(key: string): string {
  return key.startsWith(CUSTOM_KEY_PREFIX)
    ? `custom detector "${key.slice(CUSTOM_KEY_PREFIX.length)}"`
    : `built-in ${key}`;
}
