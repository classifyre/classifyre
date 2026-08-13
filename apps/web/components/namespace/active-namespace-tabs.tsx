"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { NamespaceTabs } from "@workspace/ui/components/namespace-tabs";

import { useTranslation } from "@/hooks/use-translation";
import { useNamespace } from "@/components/namespace-provider";
import { useActiveNamespaces } from "@/components/active-namespaces-provider";
import {
  currentNamespaceHref,
  upsertActiveNamespace,
  type ActiveNamespace,
} from "@/lib/active-namespaces";

/**
 * Route-backed workspace tabs. Inactive workspaces are deliberately represented
 * only by their last URL; switching routes lets Next unmount the stale UI and
 * avoids background rendering, queries, and subscriptions.
 */
export function ActiveNamespaceTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();
  const { namespace, slug, displayName } = useNamespace();
  const { items, activate: remember, replace } = useActiveNamespaces();
  const current: ActiveNamespace = React.useMemo(
    () => ({
      id: namespace?.id ?? slug,
      slug,
      name: displayName,
      href: pathname,
    }),
    [displayName, namespace?.id, pathname, slug],
  );
  const visibleItems = React.useMemo(
    () => (items.length > 0 ? items : [current]),
    [current, items],
  );
  const deactivatingSlugRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (
      deactivatingSlugRef.current !== null &&
      deactivatingSlugRef.current !== current.slug
    ) {
      deactivatingSlugRef.current = null;
    }
  }, [current.slug]);

  React.useEffect(() => {
    if (deactivatingSlugRef.current === current.slug) return;
    remember({
      ...current,
      href: currentNamespaceHref(current.slug, pathname),
    });
  }, [current, pathname, remember]);

  React.useEffect(() => {
    const saveBeforeUnload = () => {
      if (deactivatingSlugRef.current === current.slug) return;
      remember({
        ...current,
        href: currentNamespaceHref(current.slug, pathname),
      });
    };
    window.addEventListener("pagehide", saveBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", saveBeforeUnload);
      saveBeforeUnload();
    };
  }, [current, pathname, remember]);

  const persistCurrentLocation = React.useCallback(() => {
    return remember({
      ...current,
      href: currentNamespaceHref(current.slug, pathname),
    });
  }, [current, pathname, remember]);

  const activate = React.useCallback(
    (id: string) => {
      if (id === current.id) return;
      const next = persistCurrentLocation();
      const target = next.find((item) => item.id === id);
      if (target) router.push(target.href);
    },
    [current.id, persistCurrentLocation, router],
  );

  const close = React.useCallback(
    (id: string) => {
      const latest = upsertActiveNamespace(visibleItems, {
        ...current,
        href: currentNamespaceHref(current.slug, pathname),
      });
      const closedIndex = latest.findIndex((item) => item.id === id);
      if (closedIndex === -1) return;
      const next = latest.filter((item) => item.id !== id);
      replace(next);

      if (id !== current.id) return;
      deactivatingSlugRef.current = current.slug;
      const neighbor = next[closedIndex] ?? next[closedIndex - 1];
      router.push(neighbor?.href ?? "/");
    },
    [current, pathname, replace, router, visibleItems],
  );

  // A single open workspace needs no switcher; reclaim the strip's height.
  if (visibleItems.length < 2) return null;

  return (
    <NamespaceTabs
      items={visibleItems.map((item) => ({ id: item.id, label: item.name }))}
      activeId={current.id}
      ariaLabel={t("workspaces.activeTabsLabel")}
      closeLabel={(item) => t("workspaces.closeTabAria", { name: item.label })}
      onActivate={activate}
      onClose={close}
      data-testid="active-namespace-tabs"
    />
  );
}
