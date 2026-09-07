"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useNsPath } from "@/lib/ns-path";

/**
 * The page moved to /duplicates when it stopped being a fingerprint canvas and
 * became a review queue. Kept as a redirect so existing links, bookmarks and
 * anything that referenced the old route still land somewhere useful.
 */
export default function FingerprintsRedirect() {
  const router = useRouter();
  const nsPath = useNsPath();
  React.useEffect(() => {
    router.replace(nsPath("/duplicates"));
  }, [router, nsPath]);
  return null;
}
