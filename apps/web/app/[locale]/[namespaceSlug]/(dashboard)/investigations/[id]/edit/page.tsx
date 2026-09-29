"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useNsPath } from "@/lib/ns-path";
import { useRouteId } from "@/lib/use-route-id";

/**
 * There is no separate edit page any more: a case's title, description and
 * clean-up switches are edited in place in the board's Case file panel, where
 * they save as they change. Old links and bookmarks land there.
 */
export default function EditCaseRedirect() {
  const router = useRouter();
  const nsPath = useNsPath();
  const caseId = useRouteId();
  React.useEffect(() => {
    router.replace(nsPath(`/investigations/${caseId}?panel=case-file`));
  }, [router, nsPath, caseId]);
  return null;
}
