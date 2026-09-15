/**
 * Carry a detector's API-authored keys through a UI round-trip.
 *
 * Every detector editor rebuilds `pipeline_schema` from its own form state
 * rather than patching the stored object, so any key the form does not know
 * about is dropped on save. Two keys matter enough to protect:
 *
 * - `scope` restricts a detector to an asset kind, a content type, or a
 *   metadata predicate. Without this, opening a scoped detector in an editor
 *   and pressing Save would silently un-scope it, and the next run would put an
 *   LLM call on every asset of the source.
 * - `budget` bounds how long a detector may keep failing within one run. Losing
 *   it on save puts back the retry storm it was set to prevent.
 *
 * A form that renders one of these keys owns it: when the built schema sets the
 * key — even to `null`, which is how a form clears it — the form's value wins.
 * Everything else is copied forward from what was stored.
 */
const API_AUTHORED_KEYS = ["scope", "budget"] as const;

export function preserveDetectorScope(
  existing: Record<string, unknown> | undefined | null,
  built: Record<string, unknown>,
): Record<string, unknown> {
  let result = built;
  for (const key of API_AUTHORED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(built, key)) continue;
    const value = existing?.[key];
    if (value === undefined || value === null) continue;
    result = { ...result, [key]: value };
  }
  return result;
}
