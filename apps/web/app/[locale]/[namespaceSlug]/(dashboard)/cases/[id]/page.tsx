"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { useNamespace } from "@/components/namespace-provider";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import { recentCasesList, recordOpened } from "@/lib/recently-opened";
import { useRouteId } from "@/lib/use-route-id";

// Both workspaces are client-only since React Flow measures the DOM.
const CaseBoard = dynamic(
  () => import("@/components/case-board/case-board").then((m) => m.CaseBoard),
  { ssr: false },
);

const DataRequestWorkspace = dynamic(
  () =>
    import("@/components/data-request/data-request-workspace").then(
      (m) => m.DataRequestWorkspace,
    ),
  { ssr: false },
);

type ResolvedKind = "INVESTIGATION" | "DATA_REQUEST" | "error";

export default function CaseWorkspacePage() {
  const caseId = useRouteId();
  const { slug } = useNamespace();
  const nsPath = useNsPath();
  const { t } = useTranslation();
  const [kind, setKind] = React.useState<ResolvedKind | null>(null);

  // The cases page opens with the cases opened last.
  React.useEffect(() => {
    if (caseId) recordOpened(recentCasesList(slug), caseId);
  }, [caseId, slug]);

  React.useEffect(() => {
    if (!caseId) return;
    let active = true;
    setKind(null);

    api.cases
      .casesControllerFindOne({ id: caseId })
      .then((c) => {
        if (!active) return;
        setKind(c.kind === "DATA_REQUEST" ? "DATA_REQUEST" : "INVESTIGATION");
      })
      .catch(async () => {
        // Callers without `case.view` (business users) cannot read `/cases/:id`
        // but can still open their own or their team's data requests.
        try {
          await api.dataRequests.dataRequestsControllerGet({ id: caseId });
          if (active) setKind("DATA_REQUEST");
        } catch {
          if (active) setKind("error");
        }
      });

    return () => {
      active = false;
    };
  }, [caseId]);

  if (kind === null) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (kind === "error") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
        <p className="text-sm text-muted-foreground">
          {t("cases.detail.notFound")}
        </p>
        <Button variant="outline" asChild>
          <Link href={nsPath("/cases")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("cases.detail.backToCases")}
          </Link>
        </Button>
      </div>
    );
  }

  if (kind === "DATA_REQUEST") {
    return <DataRequestWorkspace caseId={caseId} />;
  }

  return <CaseBoard caseId={caseId} />;
}
