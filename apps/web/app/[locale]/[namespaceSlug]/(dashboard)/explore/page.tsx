"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNamespace } from "@/components/namespace-provider";

/**
 * Explore lives on the assets page now, as its Explore tab. Links and
 * bookmarks to /explore land there with the same view (`seeds`, `view`,
 * `saved`, …); a search there becomes the asset list's.
 */
function ExploreRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { nsHref } = useNamespace();

  React.useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "explore");
    router.replace(`${nsHref("/assets")}?${params.toString()}`);
  }, [nsHref, router, searchParams]);

  return null;
}

export default function ExplorePage() {
  return (
    <React.Suspense>
      <ExploreRedirect />
    </React.Suspense>
  );
}
