export const ACTIVE_NAMESPACES_STORAGE_KEY = "classifyre.active-namespaces.v1";

export interface ActiveNamespace {
  id: string;
  slug: string;
  name: string;
  /** Last namespace-scoped app URL, including query string and hash. */
  href: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function namespaceRoot(slug: string): string {
  return `/${encodeURIComponent(slug)}`;
}

function isNamespaceHref(href: string, slug: string): boolean {
  const root = namespaceRoot(slug);
  return (
    href === root ||
    href.startsWith(`${root}/`) ||
    href.startsWith(`${root}?`) ||
    href.startsWith(`${root}#`)
  );
}

function parseActiveNamespace(value: unknown): ActiveNamespace | null {
  if (!isRecord(value)) return null;
  const { id, slug, name, href } = value;
  if (
    typeof id !== "string" ||
    typeof slug !== "string" ||
    typeof name !== "string" ||
    typeof href !== "string" ||
    !id ||
    !slug ||
    !isNamespaceHref(href, slug)
  ) {
    return null;
  }
  return { id, slug, name: name || slug, href };
}

/** Remove malformed and duplicate tab records before using or persisting them. */
export function normalizeActiveNamespaces(
  values: unknown[],
): ActiveNamespace[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const item = parseActiveNamespace(value);
    if (!item || seen.has(item.id) || seen.has(item.slug)) return [];
    seen.add(item.id);
    seen.add(item.slug);
    return [item];
  });
}

/** Read the persisted tab records, ignoring malformed or duplicate entries. */
export function readActiveNamespaces(): ActiveNamespace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(ACTIVE_NAMESPACES_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(raw) ? normalizeActiveNamespaces(raw) : [];
  } catch {
    return [];
  }
}

/** Persist a tab set. Browser storage events keep other windows in sync. */
export function writeActiveNamespaces(items: ActiveNamespace[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ACTIVE_NAMESPACES_STORAGE_KEY,
      JSON.stringify(items),
    );
  } catch {
    // Tabs still work for this render when storage is unavailable or full.
  }
}

/** Add a namespace once, or refresh its label and last URL in place. */
export function upsertActiveNamespace(
  items: ActiveNamespace[],
  namespace: ActiveNamespace,
): ActiveNamespace[] {
  const index = items.findIndex(
    (item) => item.id === namespace.id || item.slug === namespace.slug,
  );
  if (index === -1) return [...items, namespace];
  const next = [...items];
  next[index] = namespace;
  return next;
}

export function removeActiveNamespaceFromItems(
  items: ActiveNamespace[],
  slug: string,
): ActiveNamespace[] {
  return items.filter((item) => item.slug !== slug);
}

/** Keep an existing tab valid after workspace settings rename its slug/name. */
export function updateActiveNamespaceInItems(
  items: ActiveNamespace[],
  namespace: Pick<ActiveNamespace, "id" | "slug" | "name">,
  previousSlug: string,
): ActiveNamespace[] {
  return items.map((item) => {
    if (item.id !== namespace.id && item.slug !== previousSlug) return item;
    const previousRoot = namespaceRoot(item.slug);
    const suffix = item.href.startsWith(previousRoot)
      ? item.href.slice(previousRoot.length)
      : "";
    return {
      ...item,
      ...namespace,
      href: `${namespaceRoot(namespace.slug)}${suffix}`,
    };
  });
}

/**
 * Current URL only when it still belongs to `slug`. During a route unmount the
 * address bar may already point at the workspace directory; never save that
 * global URL into the outgoing namespace tab.
 */
export function currentNamespaceHref(slug: string, fallback: string): string {
  const current =
    typeof window === "undefined"
      ? fallback
      : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (isNamespaceHref(current, slug)) return current;
  if (isNamespaceHref(fallback, slug)) return fallback;
  return namespaceRoot(slug);
}
