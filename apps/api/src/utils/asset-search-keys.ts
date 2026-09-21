import { BadRequestException } from '@nestjs/common';

/**
 * The `POST /search/assets` contract, as lists.
 *
 * Same reasoning as `finding-filter-keys.ts`, one endpoint over: the API has no
 * global ValidationPipe, and the query builder only *adds* conditions for keys
 * it recognises. A key it does not recognise never narrows the result — it
 * silently widens it, and the caller reads the whole corpus as if it were the
 * filtered answer.
 *
 * The shape here is easy to get wrong because the sibling endpoint differs:
 * findings take `{ filters, page }`, assets take `{ assets, findings, page,
 * options, semantic }`. Sending the findings shape to this endpoint returned
 * every asset in the namespace with a 200 — which is how a "filtered" GENESIS
 * query came back with unrelated Länder records on 2026-09-20.
 */
export const ASSET_SEARCH_SECTIONS = [
  'assets',
  'findings',
  'page',
  'options',
  'semantic',
] as const;

/** Keys of `SearchAssetsFiltersDto` (QueryAssetsDto minus paging, plus metadata). */
export const ASSET_FILTER_KEYS = [
  'search',
  'sourceId',
  'runnerId',
  'status',
  'sourceTypes',
  'metadata',
] as const;

const KNOWN_SECTIONS = new Set<string>(ASSET_SEARCH_SECTIONS);
const KNOWN_ASSET_FILTERS = new Set<string>(ASSET_FILTER_KEYS);

/** The known key an unknown one most plausibly meant, if any. */
function suggest(unknown: string, known: readonly string[]): string | null {
  const lower = unknown.toLowerCase();
  const candidates = [
    lower,
    lower.replace(/ies$/, 'y'),
    lower.replace(/es$/, ''),
    lower.replace(/s$/, ''),
    `${lower}s`,
  ];
  for (const candidate of candidates) {
    const match = known.find((key) => key.toLowerCase() === candidate);
    if (match && match !== unknown) return match;
  }
  return null;
}

function reject(
  kind: string,
  unknown: string[],
  known: readonly string[],
): never {
  const hints = unknown
    .map((key) => {
      const guess = suggest(key, known);
      return guess ? `${key} (did you mean ${guess}?)` : key;
    })
    .join(', ');
  throw new BadRequestException(
    `Unknown ${kind}: ${hints}. Known ${kind}s: ${known.join(', ')}. ` +
      'Rejected rather than ignored: an unrecognised key does not narrow the ' +
      'search, it returns everything.',
  );
}

/**
 * Throw 400 when the request carries a section or asset-filter key the search
 * does not read. Fails closed, exactly as the findings search does.
 */
export function assertKnownAssetSearchKeys(body: unknown): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;

  const sections = Object.keys(body as Record<string, unknown>).filter(
    (key) => !KNOWN_SECTIONS.has(key),
  );
  if (sections.length > 0) {
    reject('request section', sections, ASSET_SEARCH_SECTIONS);
  }

  const assets = (body as Record<string, unknown>).assets;
  if (assets && typeof assets === 'object' && !Array.isArray(assets)) {
    const unknown = Object.keys(assets as Record<string, unknown>).filter(
      (key) => !KNOWN_ASSET_FILTERS.has(key),
    );
    if (unknown.length > 0) reject('asset filter', unknown, ASSET_FILTER_KEYS);
  }
}
