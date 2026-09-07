"use client";

import * as React from "react";
import { getActiveNamespaceSlug } from "@workspace/api-client";
import { useOptionalNamespace } from "@/components/namespace-provider";
import { currentLocale, useLocale } from "@/lib/app-path";
import {
  DEFAULT_LOCALE,
  withLocalePrefix,
  type Locale,
} from "@/lib/locale-detection";

/**
 * The single place an app path gains its `/<locale>/<slug>` prefix. `nsPath`,
 * `useNsPath` and `nsHref` (in `components/namespace-provider.tsx`) are the
 * only three entry points, so ~210 call sites inherit both prefixes from here.
 */
export function withLocaleAndSlug(
  path: string,
  slug: string | undefined,
  locale: Locale,
): string {
  if (!path.startsWith("/")) return path;
  const scoped =
    !slug || path === `/${slug}` || path.startsWith(`/${slug}/`)
      ? path
      : `/${slug}${path === "/" ? "" : path}`;
  return locale === DEFAULT_LOCALE ? scoped : withLocalePrefix(locale, scoped);
}

/**
 * Prefix an absolute app path with the active namespace slug so links stay
 * inside the current workspace, and with the active locale so they stay in the
 * current language.
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
  return withLocaleAndSlug(path, getActiveNamespaceSlug(), currentLocale());
}

/**
 * Render-safe {@link nsPath}: takes the slug from the namespace React context
 * and the locale from the route, both of which are per-request and therefore
 * correct under concurrent server rendering. Use this for every path built
 * during render.
 */
export function useNsPath(): (path: string) => string {
  const slug = useOptionalNamespace()?.slug;
  const locale = useLocale();
  return React.useCallback(
    (path: string) => withLocaleAndSlug(path, slug, locale),
    [slug, locale],
  );
}
