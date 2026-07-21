"use client";

import { nsPath } from "@/lib/ns-path";
import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useRouteId } from "@/lib/use-route-id";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Compass,
  DownloadCloud,
  Lightbulb,
  Link2,
  Loader2,
  Paperclip,
  Pencil,
  RotateCcw,
  Save,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { AiActorBadge, isAiActor } from "@/components/ai-actor-badge";
import { AiModeSelect, type AiMode } from "@/components/ai-mode-select";
import { toast } from "sonner";
import {
  api,
  ThreadResponseDtoKindEnum,
  type CaseActivityDto,
  type CaseEventDto,
  type CaseLeadDto,
  type CaseResponseDto,
  type GraphEdgeDto,
  type GraphNodeDto,
  type InquiryResponseDto,
  type CaseLinkedInquiryDto,
  type ThreadResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Textarea } from "@workspace/ui/components/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
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
import { EmptyState } from "@workspace/ui/components/empty-state";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import { CaseStatusBadge } from "@/components/case-status-badge";
import { RunAutopilotDialog } from "@/components/autopilot/run-autopilot-dialog";
import { CaseAutopilotStatus } from "@/components/autopilot/case-autopilot-status";
import { DetailBackButton } from "@/components/detail-back-button";
import { EvidenceTable } from "@/components/evidence-table";
import { CaseThreads } from "@/components/case-threads";
import { CaseTimeline } from "@/components/case-timeline";
import { CaseChronology } from "@/components/case-chronology";
import { CaseLeads } from "@/components/case-leads";
import { useTranslation } from "@/hooks/use-translation";

const CaseGraphView = dynamic(
  () => import("@/components/case-graph/case-graph-view").then((m) => m.CaseGraphView),
  { ssr: false },
);

// The graph is the case's front door — every other view is a drill-down.
const TABS = ["graph", "evidence", "explore", "threads", "timeline", "overview"] as const;
type TabValue = (typeof TABS)[number];
const DEFAULT_TAB: TabValue = "graph";

const STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED", "ARCHIVED"] as const;
const nodeKey = (type: string, id: string) => `${type}:${id}`;
const HYP_PALETTE = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b",
  "#a855f7", "#ec4899", "#06b6d4", "#84cc16",
];

export default function CaseWorkspacePage() {
  return (
    <React.Suspense>
      <CaseWorkspaceInner />
    </React.Suspense>
  );
}

function CaseWorkspaceInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const caseId = useRouteId();

  const urlTab = searchParams.get("tab");
  const [tab, setTab] = React.useState<TabValue>(
    TABS.includes(urlTab as TabValue) ? (urlTab as TabValue) : DEFAULT_TAB,
  );
  const changeTab = (value: string) => {
    const next = value as TabValue;
    setTab(next);
    const sp = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_TAB) sp.delete("tab");
    else sp.set("tab", next);
    router.replace(
      nsPath(`/investigations/${caseId}${sp.size > 0 ? `?${sp}` : ""}`),
      { scroll: false },
    );
  };

  const [caseData, setCaseData] = React.useState<CaseResponseDto | null>(null);
  const [threads, setThreads] = React.useState<ThreadResponseDto[]>([]);
  const [allInquiries, setAllInquiries] = React.useState<InquiryResponseDto[]>([]);
  const [inquiryToLink, setInquiryToLink] = React.useState("");
  const [linkingInquiry, setLinkingInquiry] = React.useState(false);
  const [recentActivity, setRecentActivity] = React.useState<CaseActivityDto[]>([]);

  const [leads, setLeads] = React.useState<CaseLeadDto[]>([]);
  const [leadsLoading, setLeadsLoading] = React.useState(true);
  const [events, setEvents] = React.useState<CaseEventDto[]>([]);
  const [eventsLoading, setEventsLoading] = React.useState(true);
  const [timelineMode, setTimelineMode] = React.useState<"chronology" | "activity">("activity");
  const [timelineModeInitialized, setTimelineModeInitialized] = React.useState(false);

  const [aiDialogOpen, setAiDialogOpen] = React.useState(false);
  const [aiRefreshKey, setAiRefreshKey] = React.useState(0);

  const [conclusion, setConclusion] = React.useState("");
  const [savingConclusion, setSavingConclusion] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [pulling, setPulling] = React.useState<string | null>(null);

  // ── Graph state (rendered by CaseGraphView) ───────────────────────────────
  const [nodes, setNodes] = React.useState<GraphNodeDto[]>([]);
  const [edges, setEdges] = React.useState<GraphEdgeDto[]>([]);
  const [graphTruncated, setGraphTruncated] = React.useState(false);
  const [graphLoading, setGraphLoading] = React.useState(false);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadCase = React.useCallback(async () => {
    const data = await api.cases.casesControllerFindOne({ id: caseId });
    setCaseData(data);
    setConclusion((prev) => (prev ? prev : (data.conclusion ?? "")));
  }, [caseId]);

  // All inquiries, for the "link another inquiry" picker.
  React.useEffect(() => {
    api.inquiries
      .inquiriesControllerList({ limit: 200 })
      .then((res) => setAllInquiries(res.items))
      .catch(() => setAllInquiries([]));
  }, []);

  const loadThreads = React.useCallback(async () => {
    setThreads(await api.threads.caseThreadsControllerList({ caseId }));
  }, [caseId]);

  const loadRecentActivity = React.useCallback(async () => {
    try {
      const res = await api.cases.caseTimelineControllerGetTimeline({ caseId, limit: "6" });
      setRecentActivity(res.items);
    } catch {
      setRecentActivity([]);
    }
  }, [caseId]);

  const loadGraph = React.useCallback(async () => {
    setGraphLoading(true);
    try {
      const g = await api.cases.casesControllerGraph({ id: caseId, depth: 1 });
      setNodes(g.nodes);
      setEdges(g.edges);
      setGraphTruncated(Boolean(g.truncated));
    } finally {
      setGraphLoading(false);
    }
  }, [caseId]);

  const loadLeads = React.useCallback(async () => {
    setLeadsLoading(true);
    try {
      const res = await api.cases.caseLeadsControllerList({ caseId });
      setLeads(res);
    } catch {
      setLeads([]);
    } finally {
      setLeadsLoading(false);
    }
  }, [caseId]);

  const loadEvents = React.useCallback(async () => {
    setEventsLoading(true);
    try {
      const res = await api.cases.caseEventsControllerList({ caseId });
      setEvents(res);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [caseId]);

  React.useEffect(() => {
    void loadCase();
    void loadThreads();
    void loadRecentActivity();
    void loadGraph();
    void loadLeads();
    void loadEvents();
  }, [loadCase, loadThreads, loadRecentActivity, loadGraph, loadLeads, loadEvents]);

  const reloadAll = React.useCallback(() => {
    void loadCase();
    void loadThreads();
    void loadGraph();
    void loadRecentActivity();
    void loadLeads();
    void loadEvents();
  }, [loadCase, loadThreads, loadGraph, loadRecentActivity, loadLeads, loadEvents]);

  // Accept/dismiss on a lead attaches evidence — refresh both the lead queue
  // and the case's evidence, without the heavier graph/threads reloads.
  const refreshLeadsAndEvidence = React.useCallback(() => {
    void loadLeads();
    void loadCase();
  }, [loadLeads, loadCase]);

  // Chronology defaults to shown when the case already has dated events;
  // otherwise the familiar activity log stays the default. Only decided once,
  // so toggling manually afterwards isn't overridden by later reloads.
  React.useEffect(() => {
    if (!timelineModeInitialized && !eventsLoading) {
      setTimelineMode(events.length > 0 ? "chronology" : "activity");
      setTimelineModeInitialized(true);
    }
  }, [eventsLoading, events.length, timelineModeInitialized]);

  const assistantBridge = React.useMemo(
    () => ({
      contextKey: "case.manage" as const,
      canOpen: true,
      getContext: () => ({
        key: "case.manage" as const,
        route: `/investigations/${caseId}`,
        title: "Case Assistant",
        entityId: caseId,
        values: caseData
          ? { title: caseData.title, status: caseData.status }
          : {},
        schema: null,
        validation: { isValid: true, missingFields: [], errors: [] },
        metadata: {},
      }),
      // Case title/status are managed through dedicated dialogs elsewhere on
      // this page, so field patches aren't applied here.
      applyAction: () => undefined,
    }),
    [caseData, caseId],
  );

  useRegisterAssistantBridge(assistantBridge);

  // ── Derived ────────────────────────────────────────────────────────────────

  const evidence = React.useMemo(() => caseData?.evidence ?? [], [caseData]);
  const findingCount = evidence.reduce((sum, e) => sum + (e.findings?.length ?? 0), 0);

  const proposedLeadsCount = leads.filter((l) => l.status === "PROPOSED").length;

  const hypothesisThreads = threads.filter(
    (t) => t.kind === ThreadResponseDtoKindEnum.Hypothesis,
  );
  const verdictSummary = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of hypothesisThreads) {
      const s = t.status ?? "PROPOSED";
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([s, n]) => `${n} ${s.toLowerCase()}`)
      .join(" · ");
  }, [hypothesisThreads]);

  const isClosed = caseData?.status === "CLOSED" || caseData?.status === "ARCHIVED";

  const hypothesisColors = React.useMemo(() => {
    const map: Record<string, string> = {};
    threads.forEach((t, i) => {
      map[t.id] = t.color ?? HYP_PALETTE[i % HYP_PALETTE.length] ?? "#888888";
    });
    return map;
  }, [threads]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const setAiMode = async (mode: AiMode) => {
    try {
      await api.cases.casesControllerUpdate({
        id: caseId,
        updateCaseDto: { aiMode: mode as never },
      });
      toast.success(t("investigations.caseDetail.aiModeUpdated"));
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToChangeAiMode"));
    }
  };

  const changeStatus = async (status: string) => {
    try {
      await api.cases.casesControllerUpdate({
        id: caseId,
        updateCaseDto: { status: status as never },
      });
      toast.success(t("investigations.caseDetail.statusSet", { status: status.replace("_", " ").toLowerCase() }));
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToChangeStatus"));
    }
  };

  const saveConclusion = async () => {
    setSavingConclusion(true);
    try {
      await api.cases.casesControllerUpdate({ id: caseId, updateCaseDto: { conclusion } });
      toast.success(t("investigations.caseDetail.conclusionSaved"));
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToSaveConclusion"));
    } finally {
      setSavingConclusion(false);
    }
  };

  const closeCase = async () => {
    setClosing(true);
    try {
      const res = await api.cases.casesControllerClose({
        id: caseId,
        closeCaseDto: { conclusion: conclusion.trim() },
      });
      toast.success(
        res.archivedInquiries > 0
          ? t("investigations.caseDetail.caseClosedWithArchived", { count: String(res.archivedInquiries), suffix: res.archivedInquiries === 1 ? "y" : "ies" })
          : t("investigations.caseDetail.caseClosed"),
      );
      setCaseData(res._case);
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToCloseCase"));
    } finally {
      setClosing(false);
    }
  };

  const reopen = async () => changeStatus("IN_PROGRESS");

  const linkInquiry = async () => {
    if (!inquiryToLink) return;
    setLinkingInquiry(true);
    try {
      await api.cases.casesControllerLinkInquiries({
        id: caseId,
        linkInquiriesDto: { inquiryIds: [inquiryToLink] },
      });
      toast.success(t("investigations.caseDetail.inquiryLinked"));
      setInquiryToLink("");
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToLinkInquiry"));
    } finally {
      setLinkingInquiry(false);
    }
  };

  const unlinkInquiry = async (inquiryId: string) => {
    try {
      await api.cases.casesControllerUnlinkInquiry({ id: caseId, inquiryId });
      toast.success(t("investigations.caseDetail.inquiryUnlinked"));
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToUnlinkInquiry"));
    }
  };

  const pullInquiry = async (inquiryId: string) => {
    setPulling(inquiryId);
    try {
      const res = await api.cases.casesControllerPull({
        id: caseId,
        pullFromInquiryDto: { inquiryId },
      });
      toast.success(t("investigations.caseDetail.pulled", { count: String(res.pulled) }));
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToPull"));
    } finally {
      setPulling(null);
    }
  };

  const removeEvidence = async (evidenceId: string) => {
    await api.cases.casesControllerRemoveEvidence({ id: caseId, evidenceId });
    reloadAll();
  };
  const removeFinding = async (caseFindingId: string) => {
    await api.cases.casesControllerRemoveFinding({ id: caseId, caseFindingId });
    reloadAll();
  };
  const updateEvidenceNote = async (evidenceId: string, note: string) => {
    try {
      await api.cases.casesControllerPatchEvidenceNote({
        id: caseId,
        evidenceId,
        updateEvidenceNoteDto: { note: note || undefined },
      });
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToSaveNote"));
    }
  };
  const updateFindingNote = async (caseFindingId: string, note: string) => {
    try {
      await api.cases.casesControllerPatchFindingNote({
        id: caseId,
        caseFindingId,
        updateCaseFindingNoteDto: { note: note || undefined },
      });
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToSaveNote"));
    }
  };

  const mergeExpansion = React.useCallback((newNodes: GraphNodeDto[], newEdges: GraphEdgeDto[]) => {
    setNodes((prev) => {
      const m = new Map(prev.map((n) => [nodeKey(n.type, n.id), n]));
      // Only add unseen nodes: the expand endpoint is not case-aware, so its
      // copies lack caseFindingId/hypothesisIds — overwriting existing nodes
      // would make attached findings vanish from the graph.
      newNodes.forEach((n) => {
        const k = nodeKey(n.type, n.id);
        if (!m.has(k)) m.set(k, n);
      });
      return Array.from(m.values());
    });
    setEdges((prev) => {
      const m = new Map(prev.map((e) => [e.id, e]));
      newEdges.forEach((e) => m.set(e.id, e));
      return Array.from(m.values());
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!caseData) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("investigations.caseDetail.loading")}
      </div>
    );
  }

  const linkedInquiries: CaseLinkedInquiryDto[] = caseData.inquiries ?? [];
  const newMatchTotal = linkedInquiries.reduce((sum, q) => sum + q.newMatchCount, 0);
  const linkedIds = new Set(linkedInquiries.map((q) => q.id));
  const linkableInquiries = allInquiries.filter(
    (q) => !linkedIds.has(q.id) && q.status !== "ARCHIVED",
  );

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <DetailBackButton fallbackHref="/investigations" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif text-2xl font-black uppercase tracking-[0.03em]">
                {caseData.title}
              </h1>
              <CaseStatusBadge status={caseData.status} />
              <SeverityBadge severity={caseData.severity.toLowerCase() as never}>
                {caseData.severity}
              </SeverityBadge>
              {isAiActor(caseData.createdBy) && <AiActorBadge />}
              {caseData.assignee && (
                <Badge variant="outline" className="text-xs">
                  {caseData.assignee}
                </Badge>
              )}
            </div>
            {caseData.description && (
              <p className="text-muted-foreground max-w-3xl text-sm">
                {caseData.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start">
          {!isClosed && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAiDialogOpen(true)}
            >
              <Bot className="h-3.5 w-3.5 text-[color:var(--color-amber-600,#d97706)]" />{" "}
              {t("investigations.caseDetail.runAI")}
            </Button>
          )}
          <AiModeSelect
            value={(caseData.aiMode ?? "INHERIT") as AiMode}
            onChange={(mode) => void setAiMode(mode)}
          />
          {!isClosed && (
            <Select value={caseData.status} onValueChange={changeStatus}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.filter((s) => s !== "CLOSED").map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isClosed && (
            <Button variant="outline" size="sm" onClick={reopen}>
              <RotateCcw className="h-3.5 w-3.5" /> {t("investigations.caseDetail.reopen")}
            </Button>
          )}
        </div>
      </div>

      {/* ── AI autopilot visibility: working banner / latest result ── */}
      <CaseAutopilotStatus
        caseId={caseId}
        refreshKey={aiRefreshKey}
        onFinished={reloadAll}
      />
      <RunAutopilotDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        caseId={caseId}
        caseTitle={caseData.title}
        onTriggered={() => setAiRefreshKey((k) => k + 1)}
      />

      {/* ── New matches alert (always visible) ── */}
      {newMatchTotal > 0 && !isClosed && (
        <Card className="border-[color:var(--color-amber-600,#d97706)]/50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm">
              <Sparkles className="mr-1.5 inline h-4 w-4 text-[color:var(--color-amber-600,#d97706)]" />
              {t("investigations.caseDetail.newMatchesBanner", { count: String(newMatchTotal) })}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const target =
                  linkedInquiries.find((q) => q.newMatchCount > 0) ?? linkedInquiries[0];
                router.push(nsPath(`/investigations/inquiries/${target?.id}?caseId=${caseId}`));
              }}
            >
              {t("investigations.caseDetail.reviewMatches")} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={changeTab}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="graph">
              <Workflow className="h-3.5 w-3.5" /> {t("investigations.caseDetail.tabGraph")}
            </TabsTrigger>
            <TabsTrigger value="evidence">
              <Paperclip className="h-3.5 w-3.5" /> {t("investigations.caseDetail.tabEvidence")} ({evidence.length})
            </TabsTrigger>
            <TabsTrigger value="explore">
              <Compass className="h-3.5 w-3.5" /> {t("investigations.caseDetail.tabExplore")}
              {proposedLeadsCount > 0 && (
                <Badge className="ml-1 h-4 min-w-4 rounded-[3px] border-0 bg-[color:var(--color-amber-600,#d97706)] px-1 py-0 text-[10px] text-white">
                  {proposedLeadsCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="threads">
              <Lightbulb className="h-3.5 w-3.5" /> {t("investigations.caseDetail.tabThreads")} ({threads.length})
            </TabsTrigger>
            <TabsTrigger value="timeline">{t("investigations.caseDetail.tabTimeline")}</TabsTrigger>
            <TabsTrigger value="overview">{t("investigations.caseDetail.tabCaseFile")}</TabsTrigger>
          </TabsList>
          <p className="text-muted-foreground hidden font-mono text-[10px] uppercase tracking-[0.14em] lg:block">
            {evidence.length} evidence · {findingCount} finding{findingCount === 1 ? "" : "s"} ·{" "}
            {hypothesisThreads.length} hypothes{hypothesisThreads.length === 1 ? "is" : "es"}
            {verdictSummary ? ` (${verdictSummary})` : ""}
          </p>
        </div>

        {/* ════ Graph — the case's main entrance ════ */}
        <TabsContent value="graph">
          <div className="h-[calc(100vh-300px)] min-h-[520px]">
            {graphLoading && nodes.length === 0 ? (
              <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("investigations.caseDetail.buildingGraph")}
              </div>
            ) : nodes.length > 0 ? (
              <CaseGraphView
                caseId={caseId}
                nodes={nodes}
                edges={edges}
                hypotheses={hypothesisThreads}
                hypothesisColors={hypothesisColors}
                evidence={evidence}
                truncated={graphTruncated}
                onReload={reloadAll}
                onMergeExpansion={mergeExpansion}
              />
            ) : (
              <div className="flex h-full items-center justify-center border-2 border-border bg-card">
                <EmptyState
                  title={t("investigations.caseDetail.emptyGraph")}
                  description={t("investigations.caseDetail.emptyGraphDesc")}
                  action={{
                    label: t("investigations.caseDetail.addEvidence"),
                    onClick: () => router.push(nsPath(`/investigations/${caseId}/evidence/add`)),
                  }}
                  secondaryAction={{
                    label: t("investigations.caseDetail.openCaseFile"),
                    onClick: () => changeTab("overview"),
                  }}
                />
              </div>
            )}
          </div>
        </TabsContent>

        {/* ════ Case file ════ */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            {/* ── Conclusion / close flow ── */}
            <div className="space-y-3">
              <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
                {t("investigations.caseDetail.conclusion")}
              </p>
              {isClosed ? (
                <Card>
                  <CardContent className="space-y-2 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-4 w-4" /> {t("investigations.caseDetail.caseClosed")}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">
                      {caseData.conclusion || t("investigations.caseDetail.noConclusion")}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Textarea
                    value={conclusion}
                    onChange={(e) => setConclusion(e.target.value)}
                    placeholder={t("investigations.caseDetail.conclusionDesc")}
                    rows={6}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={saveConclusion}
                      disabled={savingConclusion}
                    >
                      <Save className="h-3.5 w-3.5" /> {t("investigations.caseDetail.saveDraft")}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" disabled={closing || conclusion.trim().length === 0}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t("investigations.caseDetail.closeCase")}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("investigations.caseDetail.closeCaseTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("investigations.caseDetail.closeCaseDesc")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={closeCase}>{t("investigations.caseDetail.closeCase")}</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    {conclusion.trim().length === 0 && (
                      <span className="text-muted-foreground text-xs">
                        {t("investigations.caseDetail.conclusionRequired")}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* ── Linked inquiry + recent activity ── */}
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
                  {t("investigations.caseDetail.drivingInquiries")} ({linkedInquiries.length})
                </p>
                {linkedInquiries.length === 0 && (
                  <Card>
                    <CardContent className="text-muted-foreground p-3 text-xs">
                      {t("investigations.caseDetail.noInquiryLinked")}
                    </CardContent>
                  </Card>
                )}
                {linkedInquiries.map((q) => (
                  <Card key={q.id}>
                    <CardContent className="space-y-2 p-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 shrink-0 text-[color:var(--color-amber-600,#d97706)]" />
                        <button
                          className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                          onClick={() =>
                            router.push(nsPath(`/investigations/inquiries/${q.id}?caseId=${caseId}`))
                          }
                        >
                          {q.title}
                        </button>
                        {q.status === "ARCHIVED" && (
                          <Badge variant="outline" className="text-[10px] uppercase">
                            archived
                          </Badge>
                        )}
                        {q.status !== "ARCHIVED" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            aria-label={t("investigations.caseDetail.editInquiryQuery")}
                            onClick={() =>
                              router.push(nsPath(`/investigations/inquiries/${q.id}/edit`))
                            }
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                        {!isClosed && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-muted-foreground"
                                aria-label={t("investigations.caseDetail.unlinkInquiry")}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t("investigations.caseDetail.unlinkInquiryTitle", { title: q.title })}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("investigations.caseDetail.unlinkInquiryDesc")}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => unlinkInquiry(q.id)}>
                                  {t("investigations.caseDetail.unlink")}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {q.matchCount} current match{q.matchCount === 1 ? "" : "es"}
                        {q.newMatchCount > 0 ? (
                          <span className="text-[color:var(--color-amber-600,#d97706)]">
                            {" "}· {q.newMatchCount} new
                          </span>
                        ) : (
                          ""
                        )}
                      </p>
                      {!isClosed && q.matchCount > 0 && (
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            className="flex-1"
                            onClick={() =>
                              router.push(nsPath(`/investigations/inquiries/${q.id}?caseId=${caseId}`))
                            }
                          >
                            {t("investigations.caseDetail.selectMatchesToPull")} <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pulling === q.id}
                            onClick={() => pullInquiry(q.id)}
                            title={t("investigations.caseDetail.pullAllMatches")}
                          >
                            {pulling === q.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <DownloadCloud className="h-3.5 w-3.5" />
                            )}
                            {t("investigations.caseDetail.all")}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {!isClosed && linkableInquiries.length > 0 && (
                  <div className="flex gap-1.5">
                    <Select value={inquiryToLink} onValueChange={setInquiryToLink}>
                      <SelectTrigger className="h-8 flex-1 text-xs">
                        <SelectValue placeholder={t("investigations.caseDetail.linkAnotherInquiry")} />
                      </SelectTrigger>
                      <SelectContent>
                        {linkableInquiries.map((q) => (
                          <SelectItem key={q.id} value={q.id}>
                            {q.title}{" "}
                            <span className="text-muted-foreground">({q.matchCount})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={linkInquiry}
                      disabled={!inquiryToLink || linkingInquiry}
                    >
                      {linkingInquiry ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Link2 className="h-3.5 w-3.5" />
                      )}
                      {t("investigations.caseDetail.link")}
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
                    {t("investigations.caseDetail.recentActivity")}
                  </p>
                  <button
                    className="text-muted-foreground text-xs underline"
                    onClick={() => changeTab("timeline")}
                  >
                    {t("investigations.caseDetail.fullTimeline")}
                  </button>
                </div>
                {recentActivity.length === 0 ? (
                  <p className="text-muted-foreground text-xs">{t("investigations.caseDetail.noActivity")}</p>
                ) : (
                  <div className="divide-y divide-border rounded-[4px] border-2 border-border bg-card">
                    {recentActivity.map((a) => (
                      <div key={a.id} className="flex items-baseline justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {a.activityType.toLowerCase().replace(/_/g, " ")}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-[10px]">
                          {new Date(a.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ════ Evidence ════ */}
        <TabsContent value="evidence" className="space-y-4">
          <p className="text-muted-foreground max-w-2xl text-xs">
            {t("investigations.caseDetail.evidenceTabDesc")}
          </p>
          <EvidenceTable
            evidence={evidence}
            onRemoveEvidence={removeEvidence}
            onRemoveFinding={removeFinding}
            onAddEvidence={() => router.push(nsPath(`/investigations/${caseId}/evidence/add`))}
            onAddFindings={(assetId) =>
              router.push(nsPath(`/investigations/${caseId}/evidence/add?assetId=${assetId}`))
            }
            onNoteChange={updateEvidenceNote}
            onFindingNoteChange={updateFindingNote}
          />
        </TabsContent>

        {/* ════ Explore (leads) ════ */}
        <TabsContent value="explore">
          <CaseLeads
            caseId={caseId}
            leads={leads}
            loading={leadsLoading}
            onReviewed={refreshLeadsAndEvidence}
            onGenerated={() => void loadLeads()}
          />
        </TabsContent>

        {/* ════ Threads ════ */}
        <TabsContent value="threads">
          <CaseThreads caseId={caseId} evidence={evidence} />
        </TabsContent>

        {/* ════ Timeline ════ */}
        <TabsContent value="timeline" className="space-y-4">
          <Tabs
            value={timelineMode}
            onValueChange={(v) => setTimelineMode(v as "chronology" | "activity")}
          >
            <TabsList className="h-8">
              <TabsTrigger value="chronology" className="text-xs">
                {t("investigations.caseDetail.timelineChronology")}
              </TabsTrigger>
              <TabsTrigger value="activity" className="text-xs">
                {t("investigations.caseDetail.timelineActivity")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="chronology">
              <CaseChronology
                caseId={caseId}
                events={events}
                loading={eventsLoading}
                onChanged={() => void loadEvents()}
              />
            </TabsContent>
            <TabsContent value="activity">
              <CaseTimeline caseId={caseId} />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
