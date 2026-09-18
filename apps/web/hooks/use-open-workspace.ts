"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Namespace } from "@workspace/api-client";
import { useActiveNamespaces } from "@/components/active-namespaces-provider";
import { useLocale } from "@/lib/app-path";
import { withLocalePrefix } from "@/lib/locale-detection";

/** "Open this workspace", identically wherever a workspace card is shown. */
export function useOpenWorkspace(): (namespace: Namespace) => void {
  const router = useRouter();
  const { activate } = useActiveNamespaces();
  // The directory lives under the same `[locale]` tree as the dashboard, so
  // opening a workspace from `/de/` must stay in German — an unprefixed href
  // would silently switch the language back to English.
  const locale = useLocale();

  return React.useCallback(
    (ns: Namespace) => {
      const href = withLocalePrefix(locale, `/${ns.slug}`);
      activate({
        id: ns.id,
        slug: ns.slug,
        name: ns.name,
        href,
      });
      router.push(href);
    },
    [activate, router, locale],
  );
}
