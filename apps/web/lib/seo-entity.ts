/**
 * Server-side lookup of one entity's display name, for detail-page metadata.
 *
 * Metadata is not allowed to slow a page down or fail it, so every lookup here
 * is best-effort: a short timeout, no retries, and `null` on any problem. The
 * caller (`entityMetadata`) then falls back to the generic localized section
 * title, which is strictly better than interpolating a raw UUID into `<title>`.
 *
 * Reads go straight to the API over the same `<base>/<namespace>/…` contract
 * the CLI and MCP use — see `lib/api-upstream.ts` for why not the api-client.
 */

import { apiBaseUrls } from "./api-upstream";

/** Metadata must never be the slow part of a render. */
const REQUEST_TIMEOUT_MS = 1_500;

/** How long a resolved name is reused across requests (seconds). */
const REVALIDATE_SECONDS = 60;

export type SeoEntityKind =
  | "source"
  | "asset"
  | "finding"
  | "case"
  | "inquiry"
  | "detector"
  | "scan";

/** Detail endpoint and the field holding the human name, per entity kind. */
const ENDPOINTS: Record<
  Exclude<SeoEntityKind, "scan">,
  { path: (id: string) => string; name: (body: UnknownRecord) => unknown }
> = {
  source: { path: (id) => `/sources/${id}`, name: (b) => b["name"] },
  asset: { path: (id) => `/assets/${id}`, name: (b) => b["name"] },
  // Deliberately NOT `matchedContent`: that field *is* the detected secret or
  // PII. A title reaches analytics (PostHog sends `$title` with every
  // pageview), browser history, window titles and screenshots.
  finding: {
    path: (id) => `/findings/${id}`,
    name: (b) => findingSeoName(b),
  },
  case: { path: (id) => `/cases/${id}`, name: (b) => b["title"] },
  inquiry: { path: (id) => `/inquiries/${id}`, name: (b) => b["title"] },
  detector: {
    path: (id) => `/custom-detectors/${id}`,
    name: (b) => b["name"],
  },
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

/** Truncate one title segment; the signal must never squeeze out the asset. */
function truncatePart(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength - 1)}…`
    : trimmed;
}

/**
 * SEO name for a finding: the detection signal first, then the asset it was
 * found on (e.g. `"AWS Secret Key · Q3 Invoices"`).
 *
 * The signal is the finding *type* (`findingType`, falling back to
 * `category`) — never `matchedContent`/`redactedContent`, which are the
 * detected secret or PII itself (see above). The asset name comes from the
 * embedded asset the detail endpoint already returns, so no second lookup is
 * needed. Either half may be long (a file path, a verbose detector label), so
 * each is capped before joining; the caller (`usableName`) caps the whole.
 */
function findingSeoName(body: UnknownRecord): string | null {
  const rawSignal = body["findingType"] ?? body["category"];
  const signal =
    typeof rawSignal === "string" && rawSignal.trim()
      ? truncatePart(rawSignal, 70)
      : null;

  const asset = body["asset"];
  const rawAsset = isRecord(asset)
    ? (asset["name"] ?? asset["externalUrl"])
    : null;
  const location = body["location"];
  const rawLocation =
    isRecord(location) && typeof location["path"] === "string"
      ? location["path"]
      : null;
  const rawAssetName =
    (typeof rawAsset === "string" && rawAsset.trim() ? rawAsset : null) ??
    (typeof rawLocation === "string" && rawLocation.trim()
      ? rawLocation
      : null);
  const assetName = rawAssetName ? truncatePart(rawAssetName, 50) : null;

  if (signal && assetName) return `${signal} · ${assetName}`;
  return signal ?? assetName;
}

/** A name worth putting in a title: non-empty, and not just the id again. */
function usableName(value: unknown, id: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === id) return null;
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
}

async function getJson(
  namespaceSlug: string,
  path: string,
): Promise<UnknownRecord | null> {
  for (const baseUrl of apiBaseUrls()) {
    try {
      const response = await fetch(
        `${baseUrl}/${encodeURIComponent(namespaceSlug)}${path}`,
        {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          next: { revalidate: REVALIDATE_SECONDS },
        },
      );
      if (!response.ok) continue;
      const body: unknown = await response.json();
      if (isRecord(body)) return body;
    } catch {
      // Try the next upstream candidate; exhausting them yields null.
    }
  }
  return null;
}

/**
 * The display name of one entity, or null when it cannot be resolved cheaply.
 *
 * `id` is the raw route param, so the static-export placeholder sentinel and
 * an empty segment are both handled here rather than at each of the ten call
 * sites.
 */
export async function seoEntityName(
  kind: SeoEntityKind,
  namespaceSlug: string | undefined,
  id: string | undefined,
): Promise<string | null> {
  if (!namespaceSlug || !id) return null;

  const encodedId = encodeURIComponent(id);

  // A scan is identified by its run id; the name worth showing is the source
  // it scanned, which costs a second hop.
  if (kind === "scan") {
    const runner = await getJson(namespaceSlug, `/runners/${encodedId}`);
    const sourceId = runner?.["sourceId"];
    if (typeof sourceId !== "string" || !sourceId) return null;
    const source = await getJson(
      namespaceSlug,
      `/sources/${encodeURIComponent(sourceId)}`,
    );
    return source ? usableName(source["name"], sourceId) : null;
  }

  const endpoint = ENDPOINTS[kind];
  const body = await getJson(namespaceSlug, endpoint.path(encodedId));
  return body ? usableName(endpoint.name(body), id) : null;
}
