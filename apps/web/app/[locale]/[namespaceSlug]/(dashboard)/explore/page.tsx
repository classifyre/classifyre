"use client";

import { NamespaceRedirect } from "@/components/namespace-redirect";

const EXPLORE_TAB = { tab: "explore" };

/**
 * Explore lives on the assets page now, as its Explore tab. Links and
 * bookmarks to /explore land there with the same view (`seeds`, `view`,
 * `saved`, …). Its search (`q`) was the way to find where to start, which is
 * now the asset list's search: it lands there.
 */
export default function ExplorePage() {
  return <NamespaceRedirect to="/assets" keepQuery set={EXPLORE_TAB} />;
}
