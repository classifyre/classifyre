"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useNamespace } from "@/components/namespace-provider";

/**
 * Route a namespace root to its discovery page. Done on the client rather than
 * with a server redirect so the destination is built from the same namespace
 * context every other link in the subtree uses.
 */
export default function HomePage() {
  const router = useRouter();
  const { nsHref } = useNamespace();

  React.useEffect(() => {
    router.replace(nsHref("/discovery"));
  }, [nsHref, router]);

  return null;
}
