"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Namespace } from "@workspace/api-client";
import { useActiveNamespaces } from "@/components/active-namespaces-provider";

/** "Open this workspace", identically wherever a workspace card is shown. */
export function useOpenWorkspace(): (namespace: Namespace) => void {
  const router = useRouter();
  const { activate } = useActiveNamespaces();

  return React.useCallback(
    (ns: Namespace) => {
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
