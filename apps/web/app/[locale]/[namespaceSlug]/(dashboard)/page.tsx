"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useNamespace } from "@/components/namespace-provider";

/**
 * Route a namespace root to its discovery page after the runtime namespace
 * slug has been recovered. A server redirect would bake the static-export
 * sentinel (`__id__`) into the desktop build and lose the real tenant slug.
 */
export default function HomePage() {
  const router = useRouter();
  const { nsHref } = useNamespace();

  React.useEffect(() => {
    router.replace(nsHref("/discovery"));
  }, [nsHref, router]);

  return null;
}
