"use client";

import * as React from "react";

import {
  ACTIVE_NAMESPACES_STORAGE_KEY,
  normalizeActiveNamespaces,
  readActiveNamespaces,
  removeActiveNamespaceFromItems,
  updateActiveNamespaceInItems,
  upsertActiveNamespace,
  writeActiveNamespaces,
  type ActiveNamespace,
} from "@/lib/active-namespaces";

interface ActiveNamespacesContextValue {
  items: ActiveNamespace[];
  activate: (namespace: ActiveNamespace) => ActiveNamespace[];
  replace: (items: ActiveNamespace[]) => void;
  removeBySlug: (slug: string) => void;
  update: (
    namespace: Pick<ActiveNamespace, "id" | "slug" | "name">,
    previousSlug: string,
  ) => void;
}

const ActiveNamespacesContext =
  React.createContext<ActiveNamespacesContextValue | null>(null);

/**
 * Keeps the lightweight active-workspace records alive across dashboard ↔
 * directory route changes. localStorage restores them across reloads; React
 * context is authoritative while this app window is open.
 */
export function ActiveNamespacesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [items, setItems] = React.useState<ActiveNamespace[]>([]);
  const itemsRef = React.useRef(items);

  const replace = React.useCallback((next: ActiveNamespace[]) => {
    const normalized = normalizeActiveNamespaces(next);
    itemsRef.current = normalized;
    setItems(normalized);
    writeActiveNamespaces(normalized);
  }, []);

  React.useEffect(() => {
    const stored = readActiveNamespaces();
    itemsRef.current = stored;
    setItems(stored);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== ACTIVE_NAMESPACES_STORAGE_KEY) return;
      const next = readActiveNamespaces();
      itemsRef.current = next;
      setItems(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const activate = React.useCallback(
    (namespace: ActiveNamespace) => {
      const current =
        itemsRef.current.length > 0 ? itemsRef.current : readActiveNamespaces();
      const next = upsertActiveNamespace(current, namespace);
      replace(next);
      return next;
    },
    [replace],
  );

  const removeBySlug = React.useCallback(
    (slug: string) => {
      const current =
        itemsRef.current.length > 0 ? itemsRef.current : readActiveNamespaces();
      replace(removeActiveNamespaceFromItems(current, slug));
    },
    [replace],
  );

  const update = React.useCallback(
    (
      namespace: Pick<ActiveNamespace, "id" | "slug" | "name">,
      previousSlug: string,
    ) => {
      const current =
        itemsRef.current.length > 0 ? itemsRef.current : readActiveNamespaces();
      replace(updateActiveNamespaceInItems(current, namespace, previousSlug));
    },
    [replace],
  );

  const value = React.useMemo<ActiveNamespacesContextValue>(
    () => ({ items, activate, replace, removeBySlug, update }),
    [activate, items, removeBySlug, replace, update],
  );

  return (
    <ActiveNamespacesContext.Provider value={value}>
      {children}
    </ActiveNamespacesContext.Provider>
  );
}

export function useActiveNamespaces(): ActiveNamespacesContextValue {
  const context = React.useContext(ActiveNamespacesContext);
  if (!context) {
    throw new Error(
      "useActiveNamespaces must be used within ActiveNamespacesProvider",
    );
  }
  return context;
}
