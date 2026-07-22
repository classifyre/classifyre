"use client";

import * as React from "react";
import {
  api,
  setActiveNamespaceSlug,
  type Namespace,
} from "@workspace/api-client";

interface NamespaceContextValue {
  /** Active namespace slug from the route (e.g. "acme-corp"). */
  slug: string;
  /** Registry metadata for the active namespace; null while it resolves. */
  namespace: Namespace | null;
  /** Human-readable name with the route slug as a no-flash fallback. */
  displayName: string;
  /** Build a namespace-scoped href: nsHref("/settings") → "/acme-corp/settings". */
  nsHref: (path: string) => string;
}

const NamespaceContext = React.createContext<NamespaceContextValue | null>(null);

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
  // Register immediately (module-level, idempotent) so SSR/first render is
  // scoped correctly, then keep it in sync on client navigations.
  setActiveNamespaceSlug(slug);
  React.useEffect(() => {
    setActiveNamespaceSlug(slug);
    return () => setActiveNamespaceSlug(undefined);
  }, [slug]);

  const [namespace, setNamespace] = React.useState<Namespace | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setNamespace(null);

    void api.namespaces
      .list()
      .then((items) => {
        if (!cancelled) {
          setNamespace(items.find((item) => item.slug === slug) ?? null);
        }
      })
      .catch(() => {
        // The route slug remains a useful fallback when registry metadata is
        // temporarily unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const value = React.useMemo<NamespaceContextValue>(
    () => ({
      slug,
      namespace,
      displayName: namespace?.name || slug,
      nsHref: (path: string) => {
        const normalized = path.startsWith("/") ? path : `/${path}`;
        return `/${slug}${normalized === "/" ? "" : normalized}`;
      },
    }),
    [namespace, slug],
  );

  return (
    <NamespaceContext.Provider value={value}>
      {children}
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
