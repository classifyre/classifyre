"use client";

import * as React from "react";
import { api, type NamespaceCategory } from "@workspace/api-client";

/**
 * Workspace categories from the registry, already alphabetical (the API orders
 * them). Shared by the directory, the settings form, the create dialog and the
 * management page so they never disagree about what exists.
 *
 * A load failure leaves the list empty rather than throwing: categories are a
 * grouping, and losing them must not take the workspace directory down with
 * them.
 */
export function useNamespaceCategories(): {
  categories: NamespaceCategory[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Merge a locally created/updated category in without a round trip. */
  upsert: (category: NamespaceCategory) => void;
} {
  const [categories, setCategories] = React.useState<NamespaceCategory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await api.namespaces.listCategories());
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const upsert = React.useCallback((category: NamespaceCategory) => {
    setCategories((current) => {
      const next = current.filter((item) => item.id !== category.id);
      next.push(category);
      return next.sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
      );
    });
  }, []);

  return { categories, loading, error, reload, upsert };
}
