/**
 * Carry a detector's `scope` through a UI round-trip.
 *
 * Every detector editor rebuilds `pipeline_schema` from its own form state
 * rather than patching the stored object, so any key the form does not know
 * about is dropped on save. `scope` — which restricts a detector to an asset
 * kind, a content type, or a metadata predicate — is authored through the API
 * and the MCP tools, not (yet) in these forms. Without this, opening a scoped
 * detector in the editor and pressing Save would silently un-scope it, and the
 * next run would put an LLM call on every asset of the source.
 *
 * Deliberately a copy-forward rather than a merge: the form owns every field it
 * renders, and this owns exactly the one it does not.
 */
export function preserveDetectorScope(
  existing: Record<string, unknown> | undefined | null,
  built: Record<string, unknown>,
): Record<string, unknown> {
  const scope = existing?.scope;
  if (scope === undefined || scope === null) return built;
  return { ...built, scope };
}
