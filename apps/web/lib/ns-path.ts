"use client";

import * as React from "react";
import { getActiveNamespaceSlug } from "@workspace/api-client";
import { useOptionalNamespace } from "@/components/namespace-provider";

function withSlug(path: string, slug: string | undefined): string {
  if (!slug || !path.startsWith("/")) return path;
  if (path === `/${slug}` || path.startsWith(`/${slug}/`)) return path;
  return `/${slug}${path === "/" ? "" : path}`;
}

/**
 * Prefix an absolute app path with the active namespace slug so links stay
 * inside the current workspace.
 *
 * **Event handlers only.** It resolves the slug from module state / the browser
 * URL, which is authoritative once the app is running but NOT during
 * server rendering, where a single module global is shared by every in-flight
 * request. For anything evaluated while rendering — a `href={...}` on a Link,
 * a variable that feeds one — use {@link useNsPath} instead.
 *
 * No-ops when there is no active namespace, when the path is not absolute, or
 * when it is already namespace-prefixed.
 */
export function nsPath(path: string): string {
  return withSlug(path, getActiveNamespaceSlug());
}

/**
 * Render-safe {@link nsPath}: takes the slug from the namespace React context,
 * which is per-request and therefore correct under concurrent server rendering.
 * Use this for every path built during render.
 */
export function useNsPath(): (path: string) => string {
  const slug = useOptionalNamespace()?.slug;
  return React.useCallback((path: string) => withSlug(path, slug), [slug]);
}
