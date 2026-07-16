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
