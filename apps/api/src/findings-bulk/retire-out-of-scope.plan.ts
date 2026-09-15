import { Prisma, type DetectorType } from '@prisma/client';

/**
 * Which OPEN findings a custom detector can provably no longer produce.
 *
 * Narrowing a detector (a smaller `scope.asset_kinds`, a deleted regex pattern)
 * stops new findings but leaves the old ones OPEN: a rescan never revisits an
 * out-of-scope asset with that detector, so nothing resolves them. On
 * firmenbuch-test-2 that was 99,820 findings of one detector.
 *
 * Only two changes are provable from stored data, and both mirror the scanner
 * exactly:
 *
 *  - kind: `_detector_covers_asset` compares `asset_kind.strip().lower()`
 *    against the lowercased scope list, and the API stores the kind trimmed
 *    and lowercased (`normalizeAssetKind`), so `lower(btrim(asset_type))`
 *    outside the list is out of scope on both sides;
 *  - pattern: a REGEX runner names every finding `regex:<pattern name>`
 *    (`runners/_base.py`), so a `regex:` type whose name is not a current
 *    pattern cannot be produced again — nor can any `regex:` type once the
 *    detector is no longer a REGEX detector.
 *
 * Everything else — a metadata predicate (the scanner compares Python `str()`
 * values; `str(True)` is "True" where Postgres renders "true"), content types,
 * edited patterns, renamed labels — is reported as not provable and left alone.
 */

export interface NotProvableDimension {
  dimension: string;
  hint: string;
}

export interface RetirePlan {
  detectorId: string;
  customDetectorKey: string;
  detectorName: string;
  /** `custom_detectors.version`, bumped on every pipeline-schema change. */
  detectorVersion: number;
  method: string;
  /** Lowercased scope kinds; null when the detector is not kind-scoped. */
  assetKinds: string[] | null;
  /** Current regex pattern names; [] for a detector that is not REGEX. */
  patternKeys: string[];
  /** Restrict to these sources; null for every source. */
  sourceIds: string[] | null;
  notProvable: NotProvableDimension[];
}

export interface CandidateRow {
  id: string;
  sourceId: string;
  detectorType: DetectorType;
  findingType: string;
  customDetectorKey: string | null;
  matchedContent: string | null;
  assetKind: string;
}

const REGEX_PREFIX = 'regex:';

export function buildRetirePlan(
  detector: {
    id: string;
    key: string;
    name: string;
    version: number;
    pipelineSchema: unknown;
  },
  sourceIds?: string[] | null,
): RetirePlan {
  const schema =
    detector.pipelineSchema && typeof detector.pipelineSchema === 'object'
      ? (detector.pipelineSchema as Record<string, unknown>)
      : {};
  const method = typeof schema.type === 'string' ? schema.type : '';
  const scope =
    schema.scope && typeof schema.scope === 'object'
      ? (schema.scope as Record<string, unknown>)
      : {};

  const kinds = Array.isArray(scope.asset_kinds)
    ? [
        ...new Set(
          scope.asset_kinds
            .filter((kind): kind is string => typeof kind === 'string')
            .map((kind) => kind.trim().toLowerCase())
            .filter(Boolean),
        ),
      ]
    : [];

  const patterns =
    method === 'REGEX' &&
    schema.patterns &&
    typeof schema.patterns === 'object' &&
    !Array.isArray(schema.patterns)
      ? Object.keys(schema.patterns)
      : [];

  const notProvable: NotProvableDimension[] = [];
  if (
    scope.metadata &&
    typeof scope.metadata === 'object' &&
    Object.keys(scope.metadata).length > 0
  ) {
    notProvable.push({
      dimension: 'scope.metadata',
      hint:
        'The scanner compares metadata as Python strings, which stored JSON ' +
        'cannot reproduce exactly. Findings on assets outside the metadata ' +
        'scope are left untouched.',
    });
  }
  if (Array.isArray(scope.content_types) && scope.content_types.length > 0) {
    notProvable.push({
      dimension: 'scope.content_types',
      hint:
        "The content type is decided from a payload's real MIME type during " +
        'a scan and is not stored per finding. These findings are left untouched.',
    });
  }
  if (method === 'REGEX') {
    notProvable.push({
      dimension: 'patterns (edited)',
      hint:
        'A pattern that still exists under the same name but matches ' +
        'differently cannot be judged without rescanning. Only removed ' +
        'pattern names are retired.',
    });
  } else if (method === 'GLINER2' || method === 'LLM') {
    notProvable.push({
      dimension: method === 'LLM' ? 'labels' : 'entities',
      hint:
        'Renamed or removed labels are not retired here: a label is not ' +
        'recoverable from the finding type for every runner.',
    });
  }

  const sources = [
    ...new Set(
      (sourceIds ?? []).filter(
        (id): id is string => typeof id === 'string' && id.trim().length > 0,
      ),
    ),
  ];

  return {
    detectorId: detector.id,
    customDetectorKey: detector.key,
    detectorName: detector.name,
    detectorVersion: detector.version,
    method,
    assetKinds: kinds.length > 0 ? kinds : null,
    patternKeys: patterns,
    sourceIds: sources.length > 0 ? sources : null,
    notProvable,
  };
}

/**
 * Candidates inside one physical block range of `findings`.
 *
 * Paged by TID range rather than by id: a keyset page (`id > $cursor ORDER BY
 * id LIMIT n`) walks `findings_pkey` and fetches heap rows in random order,
 * which measured 29.8 s per 2,000 candidates on an I/O-bound instance. A TID
 * range reads the heap sequentially — 4.9 s for 10,000 blocks and 2,512
 * candidates under the same load — and resumes from a block number.
 *
 * A row a concurrent write moves into an already-scanned range is missed by
 * this walk (it stays OPEN), never changed twice: every write re-checks status.
 */
export function candidatePageSql(
  plan: RetirePlan,
  fromBlock: number,
  toBlock: number,
): Prisma.Sql {
  const from = `(${Math.max(0, Math.floor(fromBlock))},0)`;
  const to = `(${Math.max(0, Math.floor(toBlock))},0)`;
  const outOfScope: Prisma.Sql[] = [];
  if (plan.assetKinds) {
    outOfScope.push(
      Prisma.sql`lower(btrim(a.asset_type)) <> ALL(${plan.assetKinds}::text[])`,
    );
  }
  // `<> ALL('{}')` is true: with no pattern left, every regex type is out.
  outOfScope.push(
    Prisma.sql`(f.finding_type LIKE 'regex:%' AND substring(f.finding_type FROM 7) <> ALL(${plan.patternKeys}::text[]))`,
  );
  const sources = plan.sourceIds
    ? Prisma.sql` AND f.source_id = ANY(${plan.sourceIds}::text[])`
    : Prisma.empty;
  return Prisma.sql`
    SELECT f.id,
           f.source_id AS "sourceId",
           f.detector_type::text AS "detectorType",
           f.finding_type AS "findingType",
           f.custom_detector_key AS "customDetectorKey",
           f.matched_content AS "matchedContent",
           lower(btrim(a.asset_type)) AS "assetKind"
    FROM findings f
    JOIN assets a ON a.id = f.asset_id
    WHERE f.ctid >= ${from}::tid AND f.ctid < ${to}::tid
      AND f.custom_detector_key = ${plan.customDetectorKey}
      AND f.status = 'OPEN'::"FindingStatus"${sources}
      AND (${Prisma.join(outOfScope, ' OR ')})
  `;
}

/**
 * Why a candidate is out of scope, as a stable key: `asset_kind:<kind>` or
 * `pattern_removed:<name>`. Kind wins when both apply, so every candidate is
 * counted under exactly one reason. Null when the row is not a candidate —
 * the SQL and this function must agree, and the spec holds them to it.
 */
export function outOfScopeReason(
  plan: RetirePlan,
  row: Pick<CandidateRow, 'findingType' | 'assetKind'>,
): string | null {
  if (plan.assetKinds && !plan.assetKinds.includes(row.assetKind)) {
    return `asset_kind:${row.assetKind}`;
  }
  if (row.findingType.startsWith(REGEX_PREFIX)) {
    const name = row.findingType.slice(REGEX_PREFIX.length);
    if (!plan.patternKeys.includes(name)) return `pattern_removed:${name}`;
  }
  return null;
}

/** The resolution reason written on a retired finding. */
export function resolutionReasonFor(plan: RetirePlan, reason: string): string {
  const [kind, ...rest] = reason.split(':');
  const value = rest.join(':');
  const why =
    kind === 'asset_kind'
      ? `asset kind "${value}" is outside its scope`
      : `pattern "${value}" was removed`;
  return `Out of scope for ${plan.customDetectorKey}: ${why}`;
}

/**
 * Whether a full walk is warranted without looking first.
 *
 * The pattern branch always applies — a detector switched away from REGEX
 * leaves `regex:` findings nothing can produce — but a detector that is neither
 * kind-scoped nor REGEX usually has none, and walking a whole table to confirm
 * that is waste. The caller probes for a stale `regex:` finding instead.
 */
export function planNeedsWalk(plan: RetirePlan): boolean {
  return plan.assetKinds !== null || plan.method === 'REGEX';
}
