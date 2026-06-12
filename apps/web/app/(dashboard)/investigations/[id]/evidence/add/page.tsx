"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { api, type CaseResponseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { FindingsTable, type FindingSelection } from "@/components/findings-table";

/**
 * Dedicated page for attaching findings to a case as evidence. Reuses the full
 * findings table (search + filters) instead of a cramped dialog. Attaching a
 * finding automatically creates the asset evidence row it belongs to.
 */
export default function AddCaseEvidencePage() {
  return (
    <React.Suspense>
      <AddCaseEvidencePageInner />
    </React.Suspense>
  );
}

function AddCaseEvidencePageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const caseId = params.id as string;
  // Optional asset context (e.g. "add more findings for this evidence row").
  const assetId = searchParams.get("assetId");

  const [caseData, setCaseData] = React.useState<CaseResponseDto | null>(null);
  const [selection, setSelection] = React.useState<FindingSelection | null>(null);
  const [attaching, setAttaching] = React.useState(false);

  const loadCase = React.useCallback(async () => {
    const data = await api.cases.casesControllerFindOne({ id: caseId });
    setCaseData(data);
  }, [caseId]);

  React.useEffect(() => {
    void loadCase();
  }, [loadCase]);

  // Findings already in the case are excluded from the table server-side.
  const attachedFindingIds = React.useMemo(() => {
    const ids: string[] = [];
    caseData?.evidence?.forEach((e) => e.findings?.forEach((f) => ids.push(f.findingId)));
    return ids;
  }, [caseData]);

  const lockedFilters = React.useMemo(
    () => ({
      ...(assetId ? { assetId: [assetId] } : {}),
      ...(attachedFindingIds.length > 0 ? { excludeIds: attachedFindingIds } : {}),
    }),
    [assetId, attachedFindingIds],
  );

  const selCount = selection?.type === "ids" ? selection.findings.length : 0;

  const attach = async () => {
    if (!selection || selection.type !== "ids" || selection.findings.length === 0) return;
    setAttaching(true);
    try {
      const res = await api.cases.casesControllerAttachFindings({
        id: caseId,
        attachFindingsDto: { findingIds: selection.findings.map((f) => f.id) },
      });
      toast.success(`Attached ${res.attached} finding${res.attached === 1 ? "" : "s"} as evidence`);
      router.push(`/investigations/${caseId}?tab=evidence`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to attach findings");
      setAttaching(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
          onClick={() => router.push(`/investigations/${caseId}?tab=evidence`)}
        >
          <ArrowLeft className="h-4 w-4" /> Back to case
        </Button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl font-black uppercase tracking-[0.03em]">
              Add evidence
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              {caseData ? (
                <>
                  Attach findings to <span className="font-medium">{caseData.title}</span>.
                  Findings already in the case are hidden. The matching asset is added as
                  evidence automatically.
                </>
              ) : (
                "Loading case…"
              )}
            </p>
          </div>
          <Button onClick={attach} disabled={attaching || selCount === 0}>
            {attaching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
            {selCount > 0
              ? `Attach ${selCount} finding${selCount === 1 ? "" : "s"}`
              : "Attach selected"}
          </Button>
        </div>
      </div>

      {caseData && (
        <FindingsTable
          key={attachedFindingIds.join(",") || "all"}
          lockedFilters={lockedFilters}
          onSelectionChange={setSelection}
          disableUrlSync
        />
      )}
    </div>
  );
}
