import { Prisma } from '@prisma/client';
import { glossaryNorm } from '../../glossary/glossary-norm';
import type { CompiledBinding } from './binding-spec';
import { isLookupMode, splitValue } from './binding-spec';

/**
 * The single home of binding semantics (SL2 §4.6).
 *
 * Every question "is this finding (or asset) evidence of that term through
 * this binding?" is answered here, twice: once in SQL (the linker, filters,
 * watch candidate queries, previews) and once in memory (Meaning cards, watch
 * matching, previews of one finding). `binding-compiler.conformance.spec.ts`
 * runs a fixed fixture through both halves for every mode and requires them to
 * agree row for row. Change one half and you must change the other.
 *
 * Values are compared through `glossary_norm` / `glossaryNorm` (NFKC, collapsed
 * whitespace, trimmed, lower-cased). Codes are compared exactly after trimming
 * spaces (`btrim`), because register codes are case-sensitive.
 */

/** A finding as both halves see it. */
export interface BindingFinding {
  id: string;
  sourceId: string;
  detectorType: string;
  customDetectorKey: string | null;
  findingType: string;
  matchedContent: string;
  status: string;
}

/** An asset as the metadata halves see it. */
export interface BindingAsset {
  id: string;
  sourceId: string;
  metadata: unknown;
}

/**
 * APPROVED concepts per lookup scheme, keyed the two ways lookups match: by
 * exact code and by normalised match key. One value naming two concepts is
 * ambiguous and links nothing.
 */
export interface LookupIndex {
  codes: Map<string, Map<string, string[]>>;
  keys: Map<string, Map<string, string[]>>;
}

export function emptyLookupIndex(): LookupIndex {
  return { codes: new Map(), keys: new Map() };
}

export function buildLookupIndex(
  concepts: Array<{
    id: string;
    schemeId: string | null;
    codes: string[];
    matchKeys: string[];
  }>,
): LookupIndex {
  const index = emptyLookupIndex();
  const add = (
    map: Map<string, Map<string, string[]>>,
    scheme: string,
    value: string,
    id: string,
  ) => {
    let byValue = map.get(scheme);
    if (!byValue) {
      byValue = new Map();
      map.set(scheme, byValue);
    }
    const ids = byValue.get(value) ?? [];
    if (!ids.includes(id)) ids.push(id);
    byValue.set(value, ids);
  };
  for (const concept of concepts) {
    if (!concept.schemeId) continue;
    for (const code of concept.codes)
      add(index.codes, concept.schemeId, code, concept.id);
    for (const key of concept.matchKeys)
      add(index.keys, concept.schemeId, key, concept.id);
  }
  return index;
}

/** `btrim(v)`: spaces only, as Postgres trims by default. */
export function sqlBtrim(value: string): string {
  return value.replace(/^ +| +$/g, '');
}

/** The concepts one value names in a lookup scheme (several = ambiguous). */
export function lookupCandidates(
  binding: Pick<CompiledBinding, 'lookupSchemeId' | 'lookupMatch'>,
  value: string,
  index: LookupIndex,
): string[] {
  if (!binding.lookupSchemeId) return [];
  if (binding.lookupMatch === 'CODES') {
    return index.codes.get(binding.lookupSchemeId)?.get(sqlBtrim(value)) ?? [];
  }
  const normalized = glossaryNorm(value);
  if (!normalized) return [];
  return index.keys.get(binding.lookupSchemeId)?.get(normalized) ?? [];
}

function inScope(binding: CompiledBinding, sourceId: string): boolean {
  return binding.sourceIds.length === 0 || binding.sourceIds.includes(sourceId);
}

/**
 * How a finding-side half treats review status. Links count OPEN findings only
 * (SL3 R2); filters and watch matchers leave status to their own dimension, so
 * they ask for `anyStatus`.
 */
export interface FindingMatchOptions {
  anyStatus?: boolean;
}

/** Whether a finding is of the binding's output (status and scope included). */
export function selectsFinding(
  binding: CompiledBinding,
  finding: Pick<
    BindingFinding,
    'sourceId' | 'detectorType' | 'findingType' | 'customDetectorKey'
  > & { status?: string },
  options: FindingMatchOptions = {},
): boolean {
  if (!binding.detectorType || !binding.findingType) return false;
  if (!options.anyStatus && finding.status !== 'OPEN') return false;
  if (finding.detectorType !== binding.detectorType) return false;
  if (finding.findingType !== binding.findingType) return false;
  if (
    binding.detectorType === 'CUSTOM' &&
    finding.customDetectorKey !== binding.customDetectorKey
  ) {
    return false;
  }
  return inScope(binding, finding.sourceId);
}

/**
 * In-memory half, findings: the term ids this finding is evidence of through
 * this binding. Empty for metadata bindings, "no meaning" bindings and
 * unmatched or ambiguous lookups.
 */
export function matchFindingTerms(
  binding: CompiledBinding,
  finding: Omit<BindingFinding, 'status' | 'matchedContent'> & {
    status?: string;
    matchedContent?: string | null;
  },
  index: LookupIndex,
  options: FindingMatchOptions = {},
): string[] {
  if (binding.noMeaning) return [];
  if (
    binding.mode === 'METADATA_VALUES' ||
    binding.mode === 'METADATA_LOOKUP'
  ) {
    return [];
  }
  if (!selectsFinding(binding, finding, options)) return [];
  const parts = splitValue(
    finding.matchedContent ?? '',
    binding.splitDelimiter,
  );
  if (binding.mode === 'OUTPUT') return binding.termId ? [binding.termId] : [];
  if (binding.mode === 'OUTPUT_VALUES') {
    const wanted = new Set(binding.values);
    return parts.some((part) => wanted.has(glossaryNorm(part))) &&
      binding.termId
      ? [binding.termId]
      : [];
  }
  const out = new Set<string>();
  for (const part of parts) {
    const candidates = lookupCandidates(binding, part, index);
    if (candidates.length === 1) out.add(candidates[0]);
  }
  return [...out];
}

/** The scalar values at a metadata path, as text (arrays expand one level). */
export function metadataValues(metadata: unknown, path: string): string[] {
  let node: unknown = metadata;
  for (const key of path.split('.')) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
    node = (node as Record<string, unknown>)[key];
  }
  const scalar = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean')
      return String(value);
    return null;
  };
  if (Array.isArray(node)) {
    return node.map(scalar).filter((value): value is string => value !== null);
  }
  const single = scalar(node);
  return single === null ? [] : [single];
}

/** In-memory half, assets: the term ids a metadata binding gives this asset. */
export function matchAssetTerms(
  binding: CompiledBinding,
  asset: BindingAsset,
  index: LookupIndex,
): string[] {
  if (binding.noMeaning) return [];
  if (
    binding.mode !== 'METADATA_VALUES' &&
    binding.mode !== 'METADATA_LOOKUP'
  ) {
    return [];
  }
  if (!binding.metadataPath || !inScope(binding, asset.sourceId)) return [];
  const parts = metadataValues(asset.metadata, binding.metadataPath).flatMap(
    (value) => splitValue(value, binding.splitDelimiter),
  );
  if (binding.mode === 'METADATA_VALUES') {
    const wanted = new Set(binding.values);
    return parts.some((part) => wanted.has(glossaryNorm(part))) &&
      binding.termId
      ? [binding.termId]
      : [];
  }
  const out = new Set<string>();
  for (const part of parts) {
    const candidates = lookupCandidates(binding, part, index);
    if (candidates.length === 1) out.add(candidates[0]);
  }
  return [...out];
}

// ── SQL half ────────────────────────────────────────────────────────────────

/** The output selector over `findings f`, OPEN and in scope (no value test). */
export function findingSelectorSql(
  binding: CompiledBinding,
  options: FindingMatchOptions = {},
): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`f.detector_type = ${binding.detectorType}::"DetectorType"`,
    Prisma.sql`f.finding_type = ${binding.findingType}`,
  ];
  if (!options.anyStatus) parts.unshift(Prisma.sql`f.status = 'OPEN'`);
  if (binding.detectorType === 'CUSTOM') {
    parts.push(
      Prisma.sql`f.custom_detector_key = ${binding.customDetectorKey}`,
    );
  }
  if (binding.sourceIds.length) {
    parts.push(Prisma.sql`f.source_id = ANY(${binding.sourceIds}::text[])`);
  }
  return Prisma.join(parts, ' AND ');
}

/**
 * The output selector as a Prisma `where`, status-free: the same predicate as
 * {@link findingSelectorSql} with `anyStatus`. For value and lookup bindings it
 * is only the coarse half; the value test needs SQL or the in-memory half.
 */
export function findingSelectorWhere(
  binding: CompiledBinding,
): Prisma.FindingWhereInput | null {
  if (!binding.detectorType || !binding.findingType) return null;
  const where: Prisma.FindingWhereInput = {
    detectorType: binding.detectorType,
    findingType: binding.findingType,
  };
  if (binding.detectorType === 'CUSTOM') {
    where.customDetectorKey = binding.customDetectorKey;
  }
  if (binding.sourceIds.length) where.sourceId = { in: binding.sourceIds };
  return where;
}

function findingPartsSql(binding: CompiledBinding): Prisma.Sql {
  return binding.splitDelimiter
    ? Prisma.sql`string_to_array(f.matched_content, ${binding.splitDelimiter})`
    : Prisma.sql`ARRAY[f.matched_content]`;
}

/** Text values at a metadata path of `assets a`, arrays expanded one level. */
function metadataPartsSql(binding: CompiledBinding): Prisma.Sql {
  const path = (binding.metadataPath ?? '').split('.');
  const node = Prisma.sql`(a.metadata #> ${path}::text[])`;
  const values = Prisma.sql`(
    SELECT e #>> '{}' AS v
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${node}) = 'array' THEN ${node} ELSE '[]'::jsonb END) e
     WHERE jsonb_typeof(e) IN ('string', 'number', 'boolean')
    UNION ALL
    SELECT ${node} #>> '{}' AS v
     WHERE jsonb_typeof(${node}) IN ('string', 'number', 'boolean')
  )`;
  return binding.splitDelimiter
    ? Prisma.sql`(SELECT p FROM ${values} mv0 CROSS JOIN LATERAL unnest(string_to_array(mv0.v, ${binding.splitDelimiter})) p)`
    : Prisma.sql`(SELECT mv0.v AS p FROM ${values} mv0)`;
}

/** Unique lookup of one text value `v` among the scheme's APPROVED concepts. */
function lookupSql(binding: CompiledBinding, value: Prisma.Sql): Prisma.Sql {
  const match =
    binding.lookupMatch === 'CODES'
      ? Prisma.sql`t.codes @> ARRAY[btrim(${value})]`
      : Prisma.sql`t.match_keys @> ARRAY[glossary_norm(${value})]`;
  return Prisma.sql`(
    SELECT (array_agg(t.id))[1] AS term_id, count(*) AS n
      FROM glossary_terms t
     WHERE t.scheme_id = ${binding.lookupSchemeId}
       AND t.kind = 'CONCEPT' AND t.status = 'APPROVED'
       AND ${match}
  )`;
}

/**
 * SQL half, findings: `(finding_id, asset_id, source_id, severity,
 * last_detected_at, term_id)` for every OPEN finding that is evidence of a term
 * through this binding, narrowed by `scope` (a predicate over `f`).
 */
export function findingTermsSql(
  binding: CompiledBinding,
  scope: Prisma.Sql = Prisma.sql`TRUE`,
): Prisma.Sql | null {
  if (binding.noMeaning) return null;
  if (
    binding.mode === 'METADATA_VALUES' ||
    binding.mode === 'METADATA_LOOKUP'
  ) {
    return null;
  }
  const selector = findingSelectorSql(binding);
  if (binding.mode === 'OUTPUT') {
    if (!binding.termId) return null;
    return Prisma.sql`
      SELECT f.id AS finding_id, f.asset_id, f.source_id, f.severity,
             f.last_detected_at, ${binding.termId}::text AS term_id
        FROM findings f
       WHERE ${selector} AND ${scope}`;
  }
  if (binding.mode === 'OUTPUT_VALUES') {
    if (!binding.termId) return null;
    return Prisma.sql`
      SELECT f.id AS finding_id, f.asset_id, f.source_id, f.severity,
             f.last_detected_at, ${binding.termId}::text AS term_id
        FROM findings f
       WHERE ${selector} AND ${scope}
         AND EXISTS (
           SELECT 1 FROM unnest(${findingPartsSql(binding)}) p
            WHERE glossary_norm(p) = ANY(${binding.values}::text[])
         )`;
  }
  return Prisma.sql`
    SELECT f.id AS finding_id, f.asset_id, f.source_id, f.severity,
           f.last_detected_at, lk.term_id
      FROM findings f
      CROSS JOIN LATERAL (
        SELECT DISTINCT m.term_id
          FROM unnest(${findingPartsSql(binding)}) p
          CROSS JOIN LATERAL ${lookupSql(binding, Prisma.sql`p`)} m
         WHERE m.n = 1
      ) lk
     WHERE ${selector} AND ${scope}`;
}

/**
 * SQL half, assets: `(asset_id, source_id, term_id)` for every asset a
 * metadata binding gives a term, narrowed by `scope` (a predicate over `a`).
 */
export function assetTermsSql(
  binding: CompiledBinding,
  scope: Prisma.Sql = Prisma.sql`TRUE`,
): Prisma.Sql | null {
  if (binding.noMeaning || !binding.metadataPath) return null;
  if (
    binding.mode !== 'METADATA_VALUES' &&
    binding.mode !== 'METADATA_LOOKUP'
  ) {
    return null;
  }
  const sourceScope = binding.sourceIds.length
    ? Prisma.sql`a.source_id = ANY(${binding.sourceIds}::text[])`
    : Prisma.sql`TRUE`;
  if (binding.mode === 'METADATA_VALUES') {
    if (!binding.termId) return null;
    return Prisma.sql`
      SELECT a.id AS asset_id, a.source_id, ${binding.termId}::text AS term_id
        FROM assets a
       WHERE ${sourceScope} AND ${scope}
         AND a.metadata IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM ${metadataPartsSql(binding)} mp
            WHERE glossary_norm(mp.p) = ANY(${binding.values}::text[])
         )`;
  }
  return Prisma.sql`
    SELECT a.id AS asset_id, a.source_id, lk.term_id
      FROM assets a
      CROSS JOIN LATERAL (
        SELECT DISTINCT m.term_id
          FROM ${metadataPartsSql(binding)} mp
          CROSS JOIN LATERAL ${lookupSql(binding, Prisma.sql`mp.p`)} m
         WHERE m.n = 1
      ) lk
     WHERE ${sourceScope} AND ${scope} AND a.metadata IS NOT NULL`;
}

/**
 * SQL half as a predicate over `findings f`: "f is evidence of one of
 * `termIds` through this binding". Filters and watch candidate queries OR
 * these together. Null when the binding can never qualify a finding.
 */
export function findingPredicateSql(
  binding: CompiledBinding,
  termIds: string[],
  options: FindingMatchOptions = {},
): Prisma.Sql | null {
  if (binding.noMeaning) return null;
  if (
    binding.mode === 'METADATA_VALUES' ||
    binding.mode === 'METADATA_LOOKUP'
  ) {
    return null;
  }
  const selector = findingSelectorSql(binding, options);
  if (binding.mode === 'OUTPUT') {
    return binding.termId && termIds.includes(binding.termId)
      ? Prisma.sql`(${selector})`
      : null;
  }
  if (binding.mode === 'OUTPUT_VALUES') {
    if (!binding.termId || !termIds.includes(binding.termId)) return null;
    return Prisma.sql`(${selector} AND EXISTS (
      SELECT 1 FROM unnest(${findingPartsSql(binding)}) p
       WHERE glossary_norm(p) = ANY(${binding.values}::text[])
    ))`;
  }
  if (!isLookupMode(binding.mode)) return null;
  return Prisma.sql`(${selector} AND EXISTS (
    SELECT 1 FROM unnest(${findingPartsSql(binding)}) p
      CROSS JOIN LATERAL ${lookupSql(binding, Prisma.sql`p`)} m
     WHERE m.n = 1 AND m.term_id = ANY(${termIds}::text[])
  ))`;
}

/** Whether a binding could ever produce links (SL-5 status rules aside). */
export function bindingLinks(binding: CompiledBinding): boolean {
  return !binding.noMeaning;
}

/**
 * "This finding carries a meaning through this binding, or is deliberately
 * unbound" — semantic coverage (SL3 R7.4). Unlike the other halves, a "no
 * meaning" binding counts here, and a lookup counts only when the value
 * resolves to exactly one concept.
 */
export function findingCoveredSql(binding: CompiledBinding): Prisma.Sql | null {
  if (
    binding.mode === 'METADATA_VALUES' ||
    binding.mode === 'METADATA_LOOKUP'
  ) {
    return null;
  }
  const selector = findingSelectorSql(binding);
  if (binding.mode === 'OUTPUT') return Prisma.sql`(${selector})`;
  if (binding.mode === 'OUTPUT_VALUES') {
    return Prisma.sql`(${selector} AND EXISTS (
      SELECT 1 FROM unnest(${findingPartsSql(binding)}) p
       WHERE glossary_norm(p) = ANY(${binding.values}::text[])
    ))`;
  }
  return Prisma.sql`(${selector} AND EXISTS (
    SELECT 1 FROM unnest(${findingPartsSql(binding)}) p
      CROSS JOIN LATERAL ${lookupSql(binding, Prisma.sql`p`)} m
     WHERE m.n = 1
  ))`;
}
