"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useNamespace } from "@/components/namespace-provider";

/**
 * The old Overview. The dashboard took its place as the starting page; links
 * and bookmarks to /discovery land there instead.
 */
export default function DiscoveryRedirect() {
  const router = useRouter();
  const { nsHref } = useNamespace();

  React.useEffect(() => {
    router.replace(nsHref("/dashboard"));
  }, [nsHref, router]);

  return null;
}
