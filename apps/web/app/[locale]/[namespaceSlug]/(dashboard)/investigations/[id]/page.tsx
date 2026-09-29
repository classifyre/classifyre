"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useNamespace } from "@/components/namespace-provider";
import { recentCasesList, recordOpened } from "@/lib/recently-opened";
import { useRouteId } from "@/lib/use-route-id";

// The case board (docs/architecture/CASE_BOARD_PRD.md) is the case: client-only,
// since React Flow measures the DOM and the layout engine runs in a worker.
const CaseBoard = dynamic(
  () => import("@/components/case-board/case-board").then((m) => m.CaseBoard),
  { ssr: false },
);

export default function CaseWorkspacePage() {
  const caseId = useRouteId();
  const { slug } = useNamespace();
  // The investigations page opens with the cases opened last.
  React.useEffect(() => {
    if (caseId) recordOpened(recentCasesList(slug), caseId);
  }, [caseId, slug]);
  return <CaseBoard caseId={caseId} />;
}
