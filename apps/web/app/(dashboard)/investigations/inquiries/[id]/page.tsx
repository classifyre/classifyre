"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRouteId } from "@/lib/use-route-id";
import {
  Archive,
  ArrowLeft,
  DownloadCloud,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AiActorBadge, isAiActor } from "@/components/ai-actor-badge";
import { AiModeSelect, type AiMode } from "@/components/ai-mode-select";
import { toast } from "sonner";
import {
  api,
  type CaseResponseDto,
  type InquiryResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import { CaseStatusBadge } from "@/components/case-status-badge";
import {
  InquiryMatchesPanel,
  type InquiryMatchesStats,
} from "@/components/inquiry-matches-panel";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import { useTranslation } from "@/hooks/use-translation";

export default function InquiryDetailPage() {
  return (
    <React.Suspense>
      <InquiryDetailInner />
    </React.Suspense>
  );
}

function InquiryDetailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const inquiryId = useRouteId();
  const preferredCaseId = searchParams.get("caseId");

  const [inquiry, setInquiry] = React.useState<InquiryResponseDto | null>(null);
  const [matchStats, setMatchStats] = React.useState<InquiryMatchesStats>({
    total: 0,
    newCount: 0,
  });
  const [matchesReloadKey, setMatchesReloadKey] = React.useState(0);
  const [targetCaseId, setTargetCaseId] = React.useState<string | null>(null);
  const [targetCase, setTargetCase] = React.useState<CaseResponseDto | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [pulling, setPulling] = React.useState(false);

  const load = React.useCallback(async () => {
    const q = await api.inquiries.inquiriesControllerFindOne({ id: inquiryId });
    setInquiry(q);
    setMatchesReloadKey((k) => k + 1);
    setSelected(new Set());
    // Pick the pull target: explicit ?caseId, else the only linked case.
    setTargetCaseId((prev) => {
      if (prev && q.cases.some((c) => c.id === prev)) return prev;
      if (preferredCaseId && q.cases.some((c) => c.id === preferredCaseId)) return preferredCaseId;
      return q.cases.length === 1 ? q.cases[0]!.id : null;
    });
  }, [inquiryId, preferredCaseId]);

  const assistantBridge = React.useMemo(
    () => ({
      contextKey: "inquiry.manage" as const,
      canOpen: true,
      getContext: () => ({
        key: "inquiry.manage" as const,
        route: `/investigations/inquiries/${inquiryId}`,
        title: "Inquiry Assistant",
        entityId: inquiryId,
        values: inquiry
          ? {
              title: inquiry.title,
              matchers: {
                matchAllSources: inquiry.matchAllSources,
                sourceIds: inquiry.sourceIds,
                detectorTypes: inquiry.detectorTypes,
                customDetectorKeys: inquiry.customDetectorKeys,
                findingTypes: inquiry.findingTypes,
                findingTypeRegex: inquiry.findingTypeRegex,
                findingValueRegex: inquiry.findingValueRegex,
              },
            }
          : {},
        schema: null,
        validation: { isValid: true, missingFields: [], errors: [] },
        metadata: {},
      }),
      // Matcher edits go through the dedicated edit page; this view doesn't
      // apply field patches directly.
      applyAction: () => undefined,
    }),
    [inquiry, inquiryId],
  );

  useRegisterAssistantBridge(assistantBridge);

  // Viewing the matches clears the "new" badge — but only after the first page
  // has loaded, so the server still flags rows as new for that initial fetch.
  const seenMarked = React.useRef(false);
  const handleMatchStats = React.useCallback(
    (stats: InquiryMatchesStats) => {
      setMatchStats(stats);
      if (!seenMarked.current && (stats.newCount > 0 || (inquiry?.newMatchCount ?? 0) > 0)) {
        seenMarked.current = true;
        void api.inquiries.inquiriesControllerMarkSeen({ id: inquiryId }).catch(() => {});
      }
    },
    [inquiryId, inquiry?.newMatchCount],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  // Load the target case's findings so we can mark matches already in it.
  React.useEffect(() => {
    if (!targetCaseId) {
      setTargetCase(null);
      return;
    }
    let cancelled = false;
    api.cases
      .casesControllerFindOne({ id: targetCaseId })
      .then((c) => {
        if (!cancelled) setTargetCase(c);
      })
      .catch(() => {
        if (!cancelled) setTargetCase(null);
      });
    return () => {
      cancelled = true;
    };
  }, [targetCaseId]);

  const inCaseFindingIds = React.useMemo(() => {
    const ids = new Set<string>();
    targetCase?.evidence?.forEach((e) => e.findings?.forEach((f) => ids.add(f.findingId)));
    return ids;
  }, [targetCase]);

  const pullableSelected = React.useMemo(
    () => Array.from(selected).filter((id) => !inCaseFindingIds.has(id)),
    [selected, inCaseFindingIds],
  );

  const rescan = async () => {
    setBusy(true);
    try {
      const res = await api.inquiries.inquiriesControllerRematch({ id: inquiryId });
      toast.success(t("investigations.inquiryDetail.rescanned", { count: String(res.landed) }));
      await load();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.inquiryDetail.rescanFailed"));
    } finally {
      setBusy(false);
    }
  };

  const pullSelected = async () => {
    if (!targetCaseId || pullableSelected.length === 0) return;
    setPulling(true);
    try {
      const res = await api.cases.casesControllerPull({
        id: targetCaseId,
        pullFromInquiryDto: { inquiryId, findingIds: pullableSelected },
      });
      toast.success(t("investigations.inquiryDetail.addedToCase", { count: String(res.pulled) }));
      const c = await api.cases.casesControllerFindOne({ id: targetCaseId });
      setTargetCase(c);
      setSelected(new Set());
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.inquiryDetail.failedToAddToCase"));
    } finally {
      setPulling(false);
    }
  };

  const setAiMode = async (mode: AiMode) => {
    await api.inquiries.inquiriesControllerUpdate({
      id: inquiryId,
      updateInquiryDto: { aiMode: mode as never },
    });
    toast.success(t("investigations.inquiryDetail.aiModeUpdated"));
    await load();
  };

  const archive = async () => {
    await api.inquiries.inquiriesControllerUpdate({
      id: inquiryId,
      updateInquiryDto: { status: "ARCHIVED" as never },
    });
    toast.success(t("investigations.inquiryDetail.archived"));
    await load();
  };

  const remove = async () => {
    await api.inquiries.inquiriesControllerRemove({ id: inquiryId });
    toast.success(t("investigations.inquiryDetail.deleted"));
    router.push("/investigations?tab=inquiries");
  };

  if (!inquiry) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("investigations.inquiryDetail.loading")}
      </div>
    );
  }

  const typeTokens = [
    ...inquiry.detectorTypes,
    ...inquiry.customDetectorKeys.map((k) => `custom:${k}`),
    ...inquiry.findingTypes,
    ...inquiry.findingTypeRegex.map((r) => `/${r}/`),
  ];
  const isArchived = inquiry.status === "ARCHIVED";
  const newCount = matchStats.newCount;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
          onClick={() => router.push("/investigations?tab=inquiries")}
        >
          <ArrowLeft className="h-4 w-4" /> {t("investigations.page.tabInquiries")}
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[4px] border-2 border-border bg-card shadow-[2px_2px_0_var(--color-border)]">
            <Sparkles className="h-4 w-4 text-[color:var(--color-amber-600,#d97706)]" />
          </span>
          <h1 className="font-serif text-2xl font-black uppercase tracking-[0.03em]">
            {inquiry.title}
          </h1>
          {isAiActor(inquiry.createdBy) && <AiActorBadge />}
          {isArchived && (
            <Badge variant="outline" className="uppercase tracking-wide">
              archived
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            <AiModeSelect
              value={(inquiry.aiMode ?? "INHERIT") as AiMode}
              onChange={(mode) => void setAiMode(mode)}
            />
            {!isArchived && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/investigations/inquiries/${inquiryId}/edit`)}
              >
                <Pencil className="h-3.5 w-3.5" /> {t("investigations.inquiryDetail.editQuery")}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={rescan} disabled={busy}>
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> {t("investigations.inquiryDetail.rescan")}
            </Button>
            {!isArchived && (
              <Button variant="outline" size="sm" onClick={archive}>
                <Archive className="h-3.5 w-3.5" /> {t("investigations.inquiryDetail.archive")}
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> {t("common.delete")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("investigations.inquiryDetail.deleteTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("investigations.inquiryDetail.deleteDesc")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={remove}>{t("common.delete")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        {inquiry.description && (
          <p className="text-muted-foreground mt-2 max-w-3xl text-sm">{inquiry.description}</p>
        )}
      </div>

      {/* ── Linked cases ── */}
      <Card className={inquiry.cases.length > 0 ? "border-accent/40" : undefined}>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
              {t("investigations.inquiryDetail.casesDriven")} ({inquiry.cases.length})
            </p>
            {!isArchived && (
              <Button
                size="sm"
                variant={inquiry.cases.length === 0 ? "default" : "outline"}
                onClick={() => router.push(`/investigations/cases/new?inquiryId=${inquiryId}`)}
              >
                <FolderPlus className="h-3.5 w-3.5" /> {t("investigations.inquiryDetail.openNewCase")}
              </Button>
            )}
          </div>
          {inquiry.cases.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("investigations.inquiryDetail.matchesLiveDesc")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {inquiry.cases.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-[4px] border border-border px-3 py-2"
                >
                  <FolderOpen className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                  <button
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                    onClick={() => router.push(`/investigations/${c.id}`)}
                  >
                    {c.title}
                  </button>
                  <CaseStatusBadge status={c.status as never} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Query definition ── */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
            {t("investigations.inquiryDetail.thisQueryLands")}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <Badge variant="outline" className="font-medium">
              {inquiry.matchAllSources
                ? t("investigations.inquiryDetail.allSources")
                : `${inquiry.sourceIds.length} source${inquiry.sourceIds.length === 1 ? "" : "s"}`}
            </Badge>
            <span className="text-muted-foreground">·</span>
            {typeTokens.length === 0 ? (
              <span className="text-muted-foreground">{t("investigations.inquiryDetail.anyFindingType")}</span>
            ) : (
              typeTokens.map((t) => (
                <span
                  key={t}
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px]"
                >
                  {t}
                </span>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Matches ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="font-serif text-lg font-black uppercase tracking-[0.04em]">{t("investigations.inquiryDetail.matchesTab")}</h2>
            <span className="text-muted-foreground text-sm tabular-nums">{matchStats.total}</span>
            {newCount > 0 && (
              <Badge
                variant="outline"
                className="border-[color:var(--color-amber-600,#d97706)]/50 text-[color:var(--color-amber-600,#d97706)]"
              >
                {newCount} new
              </Badge>
            )}
          </div>
          {inquiry.cases.length > 0 && (
            <div className="flex items-center gap-2">
              {inquiry.cases.length > 1 && (
                <Select
                  value={targetCaseId ?? ""}
                  onValueChange={(v) => setTargetCaseId(v || null)}
                >
                  <SelectTrigger className="h-8 w-56 text-xs">
                    <SelectValue placeholder={t("investigations.inquiryDetail.targetCase")} />
                  </SelectTrigger>
                  <SelectContent>
                    {inquiry.cases.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                size="sm"
                onClick={pullSelected}
                disabled={pulling || !targetCaseId || pullableSelected.length === 0}
              >
                {pulling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="h-3.5 w-3.5" />
                )}
                {t("investigations.inquiryDetail.addToCase")}
              </Button>
            </div>
          )}
        </div>
        {inquiry.cases.length > 1 && targetCase && (
          <p className="text-muted-foreground text-xs">
            {t("investigations.inquiryDetail.alreadyInCase", { title: targetCase.title })}
          </p>
        )}

        <InquiryMatchesPanel
          inquiryId={inquiryId}
          reloadKey={matchesReloadKey}
          onStats={handleMatchStats}
          inCaseFindingIds={targetCaseId ? inCaseFindingIds : undefined}
          selected={targetCaseId ? selected : undefined}
          onSelectedChange={targetCaseId ? setSelected : undefined}
        />
      </div>
    </div>
  );
}
