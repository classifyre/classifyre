"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Namespace } from "@workspace/api-client";
import { useActiveNamespaces } from "@/components/active-namespaces-provider";

/**
 * "Open this workspace", identically wherever a workspace card is shown.
 *
 * A remote card is not a workspace at all — it points at another Classifyre
 * server — so in the desktop shell it opens that server's own directory in the
 * embedded browser, and in a plain browser it simply follows the link.
 */
export function useOpenWorkspace(): (namespace: Namespace) => void {
  const router = useRouter();
  const { activate } = useActiveNamespaces();

  return React.useCallback(
    (ns: Namespace) => {
      if (ns.type === "remote" && ns.remoteUrl) {
        if (window.__CLASSIFYRE_DESKTOP__) {
          router.push(`/remote/${ns.id}`);
          return;
        }
        window.location.href = ns.remoteUrl;
        return;
      }
      activate({
        id: ns.id,
        slug: ns.slug,
        name: ns.name,
        href: `/${ns.slug}`,
      });
      router.push(`/${ns.slug}`);
    },
    [activate, router],
  );
}
