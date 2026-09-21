/**
 * Pure selection logic for the inquiry (watch) matcher form.
 *
 * The form merges several backend dimensions into three multi-selects:
 * sources (with a synthetic "All" entry), detectors (built-in types plus one
 * entry per custom detector — never the raw CUSTOM supertype), and finding
 * types (filtered by the detector selection). Everything here is a pure
 * function over plain data so the toggle semantics and the detector→type
 * pruning can be unit-tested without rendering.
 */

/** Synthetic multi-select value meaning "all sources". */
export const ALL_SOURCES_VALUE = "__all__";

/** Prefix for custom-detector entries inside the merged detector select. */
export const CUSTOM_DETECTOR_PREFIX = "custom:";

export interface MatcherSourceOption {
  id: string;
  name: string;
  type: string;
  assetCount?: number;
  openFindingCount?: number;
}

export interface MatcherCustomDetectorOption {
  key: string;
  name: string;
  openFindings?: number;
  findingTypes?: string[];
}

export interface MatcherFindingTypeOption {
  value: string;
  detectorType: string;
  count: number;
}

// ─── Sources ────────────────────────────────────────────────────────────────

/**
 * Initial multi-select values from stored matcher state. A legacy
 * `matchAllSources: false` with no ids is a dead end (the preview refuses to
 * run), so it normalises to "All" rather than preserving an empty selection.
 */
export function sourceValuesFromMatchers(
  matchAllSources: boolean,
  sourceIds: string[],
): string[] {
  if (matchAllSources || sourceIds.length === 0) return [ALL_SOURCES_VALUE];
  return [...sourceIds];
}

/**
 * Fold a full multi-select value array (as delivered by onValuesChange) into
 * the canonical selection, honouring the "All" entry:
 * - picking "All" clears every specific source;
 * - picking a specific source while "All" is selected drops "All";
 * - clearing the last entry falls back to "All" (empty selects nothing and
 *   the preview cannot run, so there is no representable empty state).
 */
export function normaliseSourceValues(
  values: string[],
  previous: string[],
): string[] {
  const hadAll = previous.includes(ALL_SOURCES_VALUE);
  const hasAll = values.includes(ALL_SOURCES_VALUE);
  if (hasAll && !hadAll) return [ALL_SOURCES_VALUE];
  if (hasAll && hadAll) {
    const rest = values.filter((v) => v !== ALL_SOURCES_VALUE);
    return rest.length > 0 ? rest : [ALL_SOURCES_VALUE];
  }
  return values.length > 0 ? values : [ALL_SOURCES_VALUE];
}

/** Stored matcher state from canonical source values. */
export function matchersFromSourceValues(values: string[]): {
  matchAllSources: boolean;
  sourceIds: string[];
} {
  if (values.includes(ALL_SOURCES_VALUE)) {
    return { matchAllSources: true, sourceIds: [] };
  }
  return { matchAllSources: false, sourceIds: [...values] };
}

// ─── Detectors (built-in types + custom detectors, merged) ─────────────────

/** Multi-select value for a custom detector key. */
export function customDetectorValue(key: string): string {
  return `${CUSTOM_DETECTOR_PREFIX}${key}`;
}

/** Inverse of customDetectorValue; null for built-in type entries. */
export function customKeyFromValue(value: string): string | null {
  return value.startsWith(CUSTOM_DETECTOR_PREFIX)
    ? value.slice(CUSTOM_DETECTOR_PREFIX.length)
    : null;
}

/**
 * Initial detector multi-select values from stored matcher state.
 *
 * The raw CUSTOM supertype is never offered as an option: legacy inquiries
 * saved with `detectorTypes: ["CUSTOM"]` and no keys meant "any custom
 * detector", so they expand to every known custom detector. CUSTOM alongside
 * named keys never widened anything (the keys restrict), so it is dropped.
 * Unknown keys (detector deleted since) are kept so saving does not silently
 * lose them; the form renders them as removable fallback entries.
 */
export function detectorValuesFromMatchers(
  detectorTypes: string[],
  customDetectorKeys: string[],
  knownCustomKeys: string[],
): string[] {
  const values = detectorTypes.filter((t) => t !== "CUSTOM");
  if (customDetectorKeys.length > 0) {
    for (const key of customDetectorKeys) {
      const v = customDetectorValue(key);
      if (!values.includes(v)) values.push(v);
    }
  } else if (detectorTypes.includes("CUSTOM")) {
    for (const key of knownCustomKeys) {
      const v = customDetectorValue(key);
      if (!values.includes(v)) values.push(v);
    }
  }
  return values;
}

/**
 * Stored matcher state from detector multi-select values. CUSTOM is never
 * emitted: an empty custom selection means "no custom filter", not
 * "all custom".
 */
export function matchersFromDetectorValues(values: string[]): {
  detectorTypes: string[];
  customDetectorKeys: string[];
} {
  const detectorTypes: string[] = [];
  const customDetectorKeys: string[] = [];
  for (const v of values) {
    const key = customKeyFromValue(v);
    if (key === null) {
      if (!detectorTypes.includes(v)) detectorTypes.push(v);
    } else if (!customDetectorKeys.includes(key)) {
      customDetectorKeys.push(key);
    }
  }
  return { detectorTypes, customDetectorKeys };
}

/**
 * Open-finding count for one detector multi-select value: built-in types sum
 * their finding-type rows (which are already scoped to the chosen sources),
 * custom detectors use the per-detector total from match-options.
 */
export function detectorOptionCount(
  value: string,
  findingTypes: MatcherFindingTypeOption[],
  customDetectors: MatcherCustomDetectorOption[],
): number {
  const key = customKeyFromValue(value);
  if (key !== null) {
    return customDetectors.find((d) => d.key === key)?.openFindings ?? 0;
  }
  return findingTypes
    .filter((t) => t.detectorType === value)
    .reduce((sum, t) => sum + t.count, 0);
}

// ─── Finding types (filtered by the detector selection) ────────────────────

export interface DetectorSelection {
  detectorTypes: string[];
  customDetectorKeys: string[];
  /**
   * Match-options custom detectors, carrying the finding types each one
   * actually emits. This is what narrows CUSTOM rows to specific detectors:
   * the type rows themselves carry no key.
   */
  customDetectors: MatcherCustomDetectorOption[];
}

/**
 * Whether a finding-type row is covered by the current detector selection. No
 * selection anywhere means "any detector" and covers all rows.
 *
 * CUSTOM rows are narrowed to the union of the types the selected custom
 * detectors actually emit — selecting one custom detector must not offer
 * another one's types. When no selected detector reports any types (orphan
 * keys, or detectors with nothing open), there is nothing to narrow by, so
 * every CUSTOM row stays visible rather than presenting an empty picker.
 */
export function isFindingTypeCovered(
  row: Pick<MatcherFindingTypeOption, "value" | "detectorType">,
  selection: DetectorSelection,
): boolean {
  const { detectorTypes, customDetectorKeys, customDetectors } = selection;
  if (detectorTypes.length === 0 && customDetectorKeys.length === 0) {
    return true;
  }
  if (row.detectorType === "CUSTOM") {
    if (customDetectorKeys.length === 0) return false;
    const selected = customDetectors.filter((d) =>
      customDetectorKeys.includes(d.key),
    );
    if (selected.length === 0) return true;
    const emitted = new Set(
      selected.flatMap((d) => d.findingTypes ?? []),
    );
    if (emitted.size === 0) return true;
    return emitted.has(row.value);
  }
  return detectorTypes.includes(row.detectorType);
}

/** Rows shown in the finding-type picker for the current selection. */
export function visibleFindingTypes(
  all: MatcherFindingTypeOption[],
  detectorTypes: string[],
  customDetectorKeys: string[],
  search: string,
  customDetectors: MatcherCustomDetectorOption[] = [],
): MatcherFindingTypeOption[] {
  const term = search.trim().toLowerCase();
  const selection: DetectorSelection = {
    detectorTypes,
    customDetectorKeys,
    customDetectors,
  };
  return all.filter(
    (t) =>
      isFindingTypeCovered(t, selection) &&
      (term.length === 0 || t.value.toLowerCase().includes(term)),
  );
}

/**
 * Drop selected finding types that the new detector selection no longer
 * covers. Types unknown to match-options (a detector deleted since, or types
 * only present under a different source scope) are kept: changing the
 * detector filter must not eat values it cannot see.
 */
export function pruneFindingTypes(
  selected: string[],
  allKnown: MatcherFindingTypeOption[],
  detectorTypes: string[],
  customDetectorKeys: string[],
  customDetectors: MatcherCustomDetectorOption[] = [],
): string[] {
  const known = new Map(allKnown.map((t) => [t.value, t]));
  const selection: DetectorSelection = {
    detectorTypes,
    customDetectorKeys,
    customDetectors,
  };
  return selected.filter((value) => {
    const row = known.get(value);
    if (row === undefined) return true;
    return isFindingTypeCovered(row, selection);
  });
}
