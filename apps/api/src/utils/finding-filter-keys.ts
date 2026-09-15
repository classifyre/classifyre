import { BadRequestException } from '@nestjs/common';

/**
 * The findings `filters` contract, as one list.
 *
 * These are exactly the keys `FindingsService.buildBaseFindingsWhere` reads,
 * and the keys of `SearchFindingsFiltersInputDto` and the MCP
 * `searchFindingsFilters` schema. Conformance specs hold all three to this
 * list, so a key added in one place and forgotten in another fails a test
 * instead of quietly doing nothing.
 *
 * Why a list at all: the API has no global ValidationPipe, and the builder only
 * ever *adds* conditions for keys it recognises. A key it does not recognise
 * therefore does not narrow the match — it silently widens it. On 2026-09-14
 * `{"findingTypes": ["regex:EUID"], "status": "OPEN"}` (plural, a typo for
 * `findingType`) collapsed to `status: OPEN` and began resolving all 686,943
 * findings of a namespace instead of the 37,428 intended. Inquiries spell these
 * same concepts in the plural (`findingTypes`, `customDetectorKeys`), so the
 * typo is the natural one to make.
 */
export const FINDING_FILTER_KEYS = [
  'search',
  'sourceId',
  'assetId',
  'runnerId',
  'detectorType',
  'customDetectorKey',
  'findingType',
  'category',
  'severity',
  'status',
  'includeResolved',
  'detectionIdentity',
  'firstDetectedAfter',
  'lastDetectedBefore',
  'excludeIds',
] as const;

export type FindingFilterKey = (typeof FINDING_FILTER_KEYS)[number];

const KNOWN = new Set<string>(FINDING_FILTER_KEYS);

/**
 * Keys that do not select a subset of the corpus: `status` and
 * `includeResolved` only decide which review states are visible, and
 * `excludeIds` only subtracts. A filter made of these alone matches every
 * finding in the namespace, which is exactly the incident shape.
 */
const NON_NARROWING = new Set<FindingFilterKey>([
  'status',
  'includeResolved',
  'excludeIds',
]);

/** The known key an unknown one most plausibly meant, if any. */
function suggestKey(unknown: string): string | null {
  const lower = unknown.toLowerCase();
  const candidates = [
    lower,
    lower.replace(/ies$/, 'y'),
    lower.replace(/es$/, ''),
    lower.replace(/s$/, ''),
  ];
  for (const candidate of candidates) {
    const match = FINDING_FILTER_KEYS.find(
      (key) => key.toLowerCase() === candidate,
    );
    if (match && match !== unknown) return match;
  }
  return null;
}

/**
 * Throw 400 when `filters` carries a key the findings query does not read.
 *
 * Fails closed on purpose: for a read, an ignored key returns more than was
 * asked for and the caller draws conclusions from it; for a bulk update, it
 * rewrites findings nobody selected.
 */
export function assertKnownFindingFilterKeys(filters: unknown): void {
  if (filters === undefined || filters === null) return;
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    throw new BadRequestException({
      message: 'filters must be an object.',
      acceptedKeys: FINDING_FILTER_KEYS,
    });
  }

  const unknownKeys = Object.keys(filters).filter((key) => !KNOWN.has(key));
  if (unknownKeys.length === 0) return;

  const suggestions: Record<string, string> = {};
  const described = unknownKeys.map((key) => {
    const suggestion = suggestKey(key);
    if (suggestion) suggestions[key] = suggestion;
    return suggestion ? `${key} (did you mean "${suggestion}"?)` : key;
  });

  throw new BadRequestException({
    message:
      `Unknown finding filter key(s): ${described.join(', ')}. ` +
      `An unrecognised filter is rejected rather than ignored, because ` +
      `ignoring it would widen the match.`,
    unknownKeys,
    suggestions,
    acceptedKeys: FINDING_FILTER_KEYS,
  });
}

/** True when a filter value actually constrains something. */
function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) {
    return value.some(
      (entry) => typeof entry === 'string' && entry.trim().length > 0,
    );
  }
  return true;
}

/**
 * Whether `filters` selects a subset of the corpus rather than all of it.
 *
 * Call only after {@link assertKnownFindingFilterKeys}: an unknown key is not
 * narrowing, but it is also not something this function should ever see.
 */
export function findingFiltersNarrow(filters: unknown): boolean {
  if (!filters || typeof filters !== 'object') return false;
  return Object.entries(filters as Record<string, unknown>).some(
    ([key, value]) =>
      KNOWN.has(key) &&
      !NON_NARROWING.has(key as FindingFilterKey) &&
      hasValue(value),
  );
}
