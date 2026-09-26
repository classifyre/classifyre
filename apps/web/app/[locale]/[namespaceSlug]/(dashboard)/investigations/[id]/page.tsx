"use client";

import dynamic from "next/dynamic";
import { useRouteId } from "@/lib/use-route-id";

// The case board (docs/architecture/CASE_BOARD_PRD.md) is the case: client-only,
// since React Flow measures the DOM and the layout engine runs in a worker.
const CaseBoard = dynamic(
  () => import("@/components/case-board/case-board").then((m) => m.CaseBoard),
  { ssr: false },
);

export default function CaseWorkspacePage() {
  const caseId = useRouteId();
  return <CaseBoard caseId={caseId} />;
}
