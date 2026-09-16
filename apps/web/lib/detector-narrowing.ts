/**
 * Whether saving `next` over `previous` can leave OPEN findings this detector
 * will never produce again: a smaller asset-kind scope, a removed regex
 * pattern, or a detector that stopped being REGEX.
 *
 * A rescan does not resolve those — the scanner skips out-of-scope assets for
 * the detector entirely — so the page offers a review when this is true. It
 * never retires anything on its own.
 */
export function narrowsDetector(previous: unknown, next: unknown): boolean {
  const before = asRecord(previous);
  const after = asRecord(next);

  const kindsBefore = kinds(before);
  const kindsAfter = kinds(after);
  if (kindsAfter) {
    // Unscoped meant every kind, so any scope is narrower.
    if (!kindsBefore) return true;
    if ([...kindsBefore].some((kind) => !kindsAfter.has(kind))) return true;
  }

  if (before.type === "REGEX") {
    if (after.type !== "REGEX") return true;
    const patternsAfter = patternKeys(after);
    if ([...patternKeys(before)].some((key) => !patternsAfter.has(key))) {
      return true;
    }
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** Lowercased scope kinds, or null when the detector covers every kind. */
function kinds(schema: Record<string, unknown>): Set<string> | null {
  const list = asRecord(schema.scope).asset_kinds;
  if (!Array.isArray(list)) return null;
  const set = new Set(
    list
      .filter((kind): kind is string => typeof kind === "string")
      .map((kind) => kind.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.size > 0 ? set : null;
}

function patternKeys(schema: Record<string, unknown>): Set<string> {
  const patterns = schema.patterns;
  return patterns && typeof patterns === "object" && !Array.isArray(patterns)
    ? new Set(Object.keys(patterns))
    : new Set();
}
