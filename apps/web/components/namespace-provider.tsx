"use client";

import * as React from "react";
import {
  api,
  setActiveNamespaceSlug,
  type Namespace,
} from "@workspace/api-client";
import { withLocaleAndSlug } from "@/lib/ns-path";
import { useLocale } from "@/lib/app-path";

interface NamespaceContextValue {
  /** Active namespace slug from the route (e.g. "acme-corp"). */
  slug: string;
  /** Registry metadata for the active namespace; null while it resolves. */
  namespace: Namespace | null;
  /** Human-readable name with the route slug as a no-flash fallback. */
  displayName: string;
  /** Build a namespace-scoped href: nsHref("/settings") → "/acme-corp/settings". */
  nsHref: (path: string) => string;
  /** Re-fetch registry metadata, e.g. after pausing from a settings card. */
  refresh: () => Promise<void>;
}

const NamespaceContext = React.createContext<NamespaceContextValue | null>(
  null,
);

/**
 * Makes the current route's namespace slug the active tenant for every API
 * call. Wraps the whole dashboard subtree (app/[namespaceSlug]/layout.tsx).
 *
 * The slug is registered with the api-client synchronously during render so
 * data fetched by the first child render already targets `/<slug>/...`.
 */
export function NamespaceProvider({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  const effectiveSlug = slug;

  // Register immediately (module-level, idempotent) so SSR/first render is
  // scoped correctly, then keep it in sync on client navigations.
  setActiveNamespaceSlug(effectiveSlug || undefined);
  React.useEffect(() => {
    setActiveNamespaceSlug(effectiveSlug || undefined);
    return () => setActiveNamespaceSlug(undefined);
  }, [effectiveSlug]);

  const locale = useLocale();

  const [namespace, setNamespace] = React.useState<Namespace | null>(null);
  // Latest slug, so a slow fetch for a previous workspace never overwrites
  // the state of the one the route points at now.
  const slugRef = React.useRef(effectiveSlug);
  slugRef.current = effectiveSlug;

  const refresh = React.useCallback(async () => {
    const slug = effectiveSlug;
    if (!slug) return;
    try {
      const items = await api.namespaces.list();
      if (slugRef.current !== slug) return;
      setNamespace(items.find((item) => item.slug === slug) ?? null);
    } catch {
      // The route slug remains a useful fallback when registry metadata is
      // temporarily unavailable.
    }
  }, [effectiveSlug]);

  React.useEffect(() => {
    setNamespace(null);
    void refresh();
  }, [refresh]);

  const value = React.useMemo<NamespaceContextValue>(
    () => ({
      slug: effectiveSlug,
      namespace,
      displayName: namespace?.name || effectiveSlug,
      nsHref: (path: string) => {
        const normalized = path.startsWith("/") ? path : `/${path}`;
        return withLocaleAndSlug(normalized, effectiveSlug, locale);
      },
      refresh,
    }),
    [effectiveSlug, namespace, locale, refresh],
  );

  // A namespace route always carries a slug; the guard is here so a malformed
  // one renders nothing rather than scoping every API call to an empty tenant.
  if (!effectiveSlug) return null;

  return (
    <NamespaceContext.Provider value={value}>
      {/* Switching workspaces reuses this layout instance — it is the same
          route segment — so key the subtree to drop state and in-flight data
          belonging to the old tenant. */}
      <React.Fragment key={effectiveSlug}>{children}</React.Fragment>
    </NamespaceContext.Provider>
  );
}

/** Access the active namespace + a namespace-aware href builder. */
export function useNamespace(): NamespaceContextValue {
  const ctx = React.useContext(NamespaceContext);
  if (!ctx) {
    throw new Error("useNamespace must be used within a NamespaceProvider");
  }
  return ctx;
}

/** Like useNamespace but returns null outside a namespace (e.g. landing page). */
export function useOptionalNamespace(): NamespaceContextValue | null {
  return React.useContext(NamespaceContext);
}
