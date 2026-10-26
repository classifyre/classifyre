"use client";

import { Suspense } from "react";
import { ExploreWorkspace } from "@/components/explore/explore-workspace";

export default function ExplorePage() {
  // The view lives in the address (useSearchParams), which a static export
  // only has in the browser.
  return (
    <Suspense>
      <ExploreWorkspace />
    </Suspense>
  );
}
