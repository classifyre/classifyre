/**
 * AI provider credentials: what a stored API key is bound to.
 *
 * Pure translation between the loaded credential and the form draft lives
 * here, out of the component, so the write-only-key rule (a stored key is
 * dropped when the provider or endpoint changes) is testable on its own.
 * Mirrors providerEndpointKey in the API, which drops a stored key when the
 * endpoint changes so that pointing a provider somewhere else can never ship
 * an old key there.
 */

/** Trim, strip trailing slashes, lowercase; null and empty are equal. */
export function normalizeProviderBaseUrl(
  value: string | null | undefined,
): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

export function aiProviderEndpointKey(
  provider: string,
  baseUrl: string | null | undefined,
): string {
  return `${provider}|${normalizeProviderBaseUrl(baseUrl)}`;
}

export type AiProviderKeyDraft = {
  provider: string;
  baseUrl: string;
  /** A newly typed key. Blank leaves the stored one alone. */
  apiKey: string;
  hasStoredKey: boolean;
  /**
   * The endpoint the stored key was entered for. Null when no key is stored.
   */
  storedEndpoint: string | null;
};

/** Whether the stored key survives this save. */
export function providerStoredKeyIsKept(draft: AiProviderKeyDraft): boolean {
  return (
    draft.hasStoredKey &&
    draft.storedEndpoint ===
      aiProviderEndpointKey(draft.provider, draft.baseUrl)
  );
}
