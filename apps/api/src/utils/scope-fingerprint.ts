import { createHash } from 'crypto';

/**
 * Config sections that do not narrow or widen which objects a scan visits.
 *
 * - `masked` holds credentials: rotating a secret must not read as a scope move.
 * - `sampling` chooses how much of the scope to visit per run, not what the
 *   scope is.
 * - `detectors` / `custom_detectors` decide what runs over an object once it is
 *   already in scope.
 * - `resources` is runtime sizing.
 */
const NON_SCOPE_SECTIONS = new Set([
  'masked',
  'sampling',
  'detectors',
  'custom_detectors',
  'resources',
  // Additive by construction: an augmentation notebook can only add metadata,
  // tags, links, URNs and edges, never move which objects a scan visits.
  // Leaving it in would force a conservative full rescan on every code edit.
  'augmentation',
]);

/** Recursively sort object keys so JSON.stringify is order-independent. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    sorted[key] = canonicalize(source[key]);
  }
  return sorted;
}

/**
 * Fingerprints the scope-determining subset of a source config.
 *
 * Two runs sharing a fingerprint visited the same logical scope, so an asset
 * absent from the later one is genuinely gone from the source. Two runs with
 * different fingerprints are not comparable that way: absence may just mean the
 * scope moved, which is why `finalizeIngestRun` refuses to delete across a
 * fingerprint change.
 *
 * Deliberately over-inclusive. Every key under `required`/`optional` counts,
 * even ones that only affect enrichment (`include_object_metadata`) rather than
 * scope. A false "scope changed" costs one conservative run; a false "scope
 * unchanged" destroys assets. The asymmetry decides the default.
 */
export function computeScopeFingerprint(
  sourceType: string,
  config: unknown,
): string {
  const raw =
    config && typeof config === 'object'
      ? (config as Record<string, unknown>)
      : {};

  const scoped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (NON_SCOPE_SECTIONS.has(key)) continue;
    scoped[key] = value;
  }
  // Assigned last: the caller's source type is authoritative and must not be
  // shadowed by a stale or absent `type` inside the stored config.
  scoped.type = sourceType;

  return createHash('sha256')
    .update(JSON.stringify(canonicalize(scoped)), 'utf8')
    .digest('hex');
}

/** Config sections that decide WHAT is looked for once an object is in scope. */
const DETECTION_SECTIONS = ['detectors', 'custom_detectors'] as const;

/**
 * Fingerprints the detection-determining subset of a source config.
 *
 * The complement of {@link computeScopeFingerprint}, which deliberately ignores
 * these sections because they do not move the scope. This one exists to answer
 * a different question: "has anything about what we detect changed since the
 * last time the autopilot re-scanned this source?"
 *
 * That question is what makes the re-scan guard precise. A blunt cooldown stops
 * the runaway loop (re-scan → source dirty → next cycle → re-scan again) but
 * also stops the legitimate sequence, where the config agent retunes detectors
 * and re-scans, and the detector-authoring agent then ships a new detector in
 * the same cycle and needs its own re-scan to test it. Comparing detection
 * fingerprints permits the second re-scan precisely when there is something new
 * to detect, and refuses it when there is not.
 *
 * `sampling` is included: reading further into a source is a genuine reason to
 * scan again, and an agent that widened the sample would otherwise be told
 * nothing had changed.
 */
export function computeDetectionFingerprint(
  sourceType: string,
  config: unknown,
): string {
  const raw =
    config && typeof config === 'object'
      ? (config as Record<string, unknown>)
      : {};

  const detection: Record<string, unknown> = { type: sourceType };
  for (const key of [...DETECTION_SECTIONS, 'sampling']) {
    if (key in raw) detection[key] = raw[key];
  }

  return createHash('sha256')
    .update(JSON.stringify(canonicalize(detection)), 'utf8')
    .digest('hex');
}

/**
 * One custom detector, reduced to what decides its verdicts.
 *
 * `definition` is the stored pipeline schema; `trainedAt` moves when the
 * detector is retrained; `files` are the runtime files it loads, by content.
 */
export interface SamplingFingerprintDetector {
  key: string;
  active: boolean;
  definition: unknown;
  trainedAt: string | null;
  files: Array<{ name: string; hash: string }>;
}

/** Keys whose values are credentials wherever they sit in a config. */
const CREDENTIAL_KEYS = new Set(['masked', 'secrets']);

function withoutCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCredentials);
  if (value === null || typeof value !== 'object') return value;
  const kept: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (CREDENTIAL_KEYS.has(key)) continue;
    kept[key] = withoutCredentials(entry);
  }
  return kept;
}

/**
 * Fingerprints everything that decides what a scan of this source does.
 *
 * An AUTOMATIC sweep keeps its place between runs, and that place is only
 * worth keeping while the source is being scanned the same way. Move the
 * scope, change the sampling, switch a detector on or off, edit or retrain or
 * delete a custom detector the source uses: the ground already covered was
 * covered under other terms, so the sweep starts over. Two runs sharing this
 * fingerprint are continuing one sweep; two that differ are not.
 *
 * Unlike the scope and detection fingerprints this takes the whole config,
 * because "any setting" is the rule. The one exception is credentials
 * (`masked`, and any `secrets` block): rotating a password changes nothing
 * about what is read, and their stored form is ciphertext that differs on
 * every save.
 *
 * `detectors` are the custom detectors the config refers to. They live outside
 * the config, so editing one changes no source row -- which is why their
 * definitions are folded in here rather than each edit having to go and find
 * the sources that use it.
 */
export function computeSamplingFingerprint(
  sourceType: string,
  config: unknown,
  detectors: SamplingFingerprintDetector[] = [],
): string {
  const raw =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};

  const settings = withoutCredentials(raw) as Record<string, unknown>;
  settings.type = sourceType;

  const used = [...detectors]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((detector) => ({
      key: detector.key,
      active: detector.active,
      definition: withoutCredentials(detector.definition),
      trainedAt: detector.trainedAt,
      files: [...detector.files].sort((a, b) => a.name.localeCompare(b.name)),
    }));

  return createHash('sha256')
    .update(JSON.stringify(canonicalize({ settings, detectors: used })), 'utf8')
    .digest('hex');
}
