"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  DownloadCloud,
  Lightbulb,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  RotateCcw,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  ThreadResponseDtoKindEnum,
  type CaseActivityDto,
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
import { CaseStatusBadge } from "@/components/case-status-badge";
import { EvidenceTable } from "@/components/evidence-table";
import { CaseThreads } from "@/components/case-threads";
import { CaseTimeline } from "@/components/case-timeline";

const CaseGraphView = dynamic(
  () => import("@/components/case-graph/case-graph-view").then((m) => m.CaseGraphView),
  { ssr: false },
);

const TABS = ["overview", "evidence", "threads", "timeline", "graph"] as const;
type TabValue = (typeof TABS)[number];

const STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED", "ARCHIVED"] as const;
const nodeKey = (type: string, id: string) => `${type}:${id}`;
const HYP_PALETTE = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b",
  "#a855f7", "#ec4899", "#06b6d4", "#84cc16",
];

function StatCard({
  label,
  value,
  hint,
  icon,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="rounded-[4px] border-2 border-border bg-card p-4 text-left shadow-[0_1px_3px_rgba(28,25,23,0.04)] transition-colors enabled:hover:border-foreground/30"
    >
      <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 font-serif text-2xl font-black tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
    </button>
  );
}

export default function CaseWorkspacePage() {
  return (
    <React.Suspense>
      <CaseWorkspaceInner />
    </React.Suspense>
  );
}

function CaseWorkspaceInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const caseId = params.id as string;

  const urlTab = searchParams.get("tab");
  const [tab, setTab] = React.useState<TabValue>(
    TABS.includes(urlTab as TabValue) ? (urlTab as TabValue) : "overview",
  );
  const changeTab = (value: string) => {
    const next = value as TabValue;
    setTab(next);
    const sp = new URLSearchParams(searchParams.toString());
    if (next === "overview") sp.delete("tab");
    else sp.set("tab", next);
    router.replace(`/investigations/${caseId}${sp.size > 0 ? `?${sp}` : ""}`, { scroll: false });
  };

  const [caseData, setCaseData] = React.useState<CaseResponseDto | null>(null);
  const [threads, setThreads] = React.useState<ThreadResponseDto[]>([]);
  const [allInquiries, setAllInquiries] = React.useState<InquiryResponseDto[]>([]);
  const [inquiryToLink, setInquiryToLink] = React.useState("");
  const [linkingInquiry, setLinkingInquiry] = React.useState(false);
  const [recentActivity, setRecentActivity] = React.useState<CaseActivityDto[]>([]);

  const [conclusion, setConclusion] = React.useState("");
  const [savingConclusion, setSavingConclusion] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [pulling, setPulling] = React.useState<string | null>(null);

  // ── Graph state (rendered by CaseGraphView) ───────────────────────────────
  const [nodes, setNodes] = React.useState<GraphNodeDto[]>([]);
  const [edges, setEdges] = React.useState<GraphEdgeDto[]>([]);
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
    } finally {
      setGraphLoading(false);
    }
  }, [caseId]);

  React.useEffect(() => {
    void loadCase();
    void loadThreads();
    void loadRecentActivity();
    void loadGraph();
  }, [loadCase, loadThreads, loadRecentActivity, loadGraph]);

  const reloadAll = React.useCallback(() => {
    void loadCase();
    void loadThreads();
    void loadGraph();
    void loadRecentActivity();
  }, [loadCase, loadThreads, loadGraph, loadRecentActivity]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const evidence = React.useMemo(() => caseData?.evidence ?? [], [caseData]);
  const findingCount = evidence.reduce((sum, e) => sum + (e.findings?.length ?? 0), 0);

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

  const changeStatus = async (status: string) => {
    try {
      await api.cases.casesControllerUpdate({
        id: caseId,
        updateCaseDto: { status: status as never },
      });
      toast.success(`Status set to ${status.replace("_", " ").toLowerCase()}`);
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error("Failed to change status");
    }
  };

  const saveConclusion = async () => {
    setSavingConclusion(true);
    try {
      await api.cases.casesControllerUpdate({ id: caseId, updateCaseDto: { conclusion } });
      toast.success("Conclusion saved");
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error("Failed to save conclusion");
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
          ? `Case closed — ${res.archivedInquiries} inquir${res.archivedInquiries === 1 ? "y" : "ies"} archived`
          : "Case closed",
      );
      setCaseData(res._case);
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error("Failed to close case");
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
      toast.success("Inquiry linked");
      setInquiryToLink("");
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error("Failed to link inquiry");
    } finally {
      setLinkingInquiry(false);
    }
  };

  const unlinkInquiry = async (inquiryId: string) => {
    try {
      await api.cases.casesControllerUnlinkInquiry({ id: caseId, inquiryId });
      toast.success("Inquiry unlinked");
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error("Failed to unlink inquiry");
    }
  };

  const pullInquiry = async (inquiryId: string) => {
    setPulling(inquiryId);
    try {
      const res = await api.cases.casesControllerPull({
        id: caseId,
        pullFromInquiryDto: { inquiryId },
      });
      toast.success(`Pulled ${res.pulled} finding${res.pulled === 1 ? "" : "s"} into evidence`);
      reloadAll();
    } catch (err) {
      console.error(err);
      toast.error("Failed to pull matches");
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
      toast.error("Failed to save note");
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
      toast.error("Failed to save note");
    }
  };

  const mergeExpansion = React.useCallback((newNodes: GraphNodeDto[], newEdges: GraphEdgeDto[]) => {
    setNodes((prev) => {
      const m = new Map(prev.map((n) => [nodeKey(n.type, n.id), n]));
      newNodes.forEach((n) => m.set(nodeKey(n.type, n.id), n));
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
        <Loader2 className="h-4 w-4 animate-spin" /> Loading case…
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
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
          onClick={() => router.push("/investigations")}
        >
          <ArrowLeft className="h-4 w-4" /> Cases
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-2xl font-black uppercase tracking-[0.03em]">
            {caseData.title}
          </h1>
          <CaseStatusBadge status={caseData.status} />
          <SeverityBadge severity={caseData.severity.toLowerCase() as never}>
            {caseData.severity}
          </SeverityBadge>
          {caseData.assignee && (
            <Badge variant="outline" className="text-xs">
              {caseData.assignee}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
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
                <RotateCcw className="h-3.5 w-3.5" /> Reopen
              </Button>
            )}
          </div>
        </div>
        {caseData.description && (
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm">{caseData.description}</p>
        )}
      </div>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="evidence">Evidence ({evidence.length})</TabsTrigger>
          <TabsTrigger value="threads">Threads ({threads.length})</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
        </TabsList>

        {/* ════ Overview ════ */}
        <TabsContent value="overview" className="space-y-6">
          {/* New matches alert */}
          {newMatchTotal > 0 && !isClosed && (
            <Card className="border-[color:var(--color-amber-600,#d97706)]/50">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-sm">
                  <Sparkles className="mr-1.5 inline h-4 w-4 text-[color:var(--color-amber-600,#d97706)]" />
                  {newMatchTotal} new match{newMatchTotal === 1 ? "" : "es"} appeared in the
                  linked inquir{linkedInquiries.length === 1 ? "y" : "ies"} since last review.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const target =
                      linkedInquiries.find((q) => q.newMatchCount > 0) ?? linkedInquiries[0];
                    router.push(`/investigations/inquiries/${target?.id}?caseId=${caseId}`);
                  }}
                >
                  Review matches <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Stats */}
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Evidence"
              value={evidence.length}
              hint={`${findingCount} finding${findingCount === 1 ? "" : "s"} attached`}
              icon={<Paperclip className="h-3 w-3" />}
              onClick={() => changeTab("evidence")}
            />
            <StatCard
              label="Hypotheses"
              value={hypothesisThreads.length}
              hint={verdictSummary || "none yet"}
              icon={<Lightbulb className="h-3 w-3" />}
              onClick={() => changeTab("threads")}
            />
            <StatCard
              label="Discussions"
              value={threads.length - hypothesisThreads.length}
              hint="open threads"
              icon={<MessageSquare className="h-3 w-3" />}
              onClick={() => changeTab("threads")}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            {/* ── Conclusion / close flow ── */}
            <div className="space-y-3">
              <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
                Conclusion
              </p>
              {isClosed ? (
                <Card>
                  <CardContent className="space-y-2 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-4 w-4" /> Case closed
                    </p>
                    <p className="whitespace-pre-wrap text-sm">
                      {caseData.conclusion || "No conclusion recorded."}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Textarea
                    value={conclusion}
                    onChange={(e) => setConclusion(e.target.value)}
                    placeholder="Summarize what the evidence shows, which hypothesis it supports, and how strongly. Closing the case archives its inquiry."
                    rows={6}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={saveConclusion}
                      disabled={savingConclusion}
                    >
                      <Save className="h-3.5 w-3.5" /> Save draft
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" disabled={closing || conclusion.trim().length === 0}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Close case
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Close this case?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The conclusion is recorded, the case is marked closed and{" "}
                            {linkedInquiries.length > 0
                              ? "its linked inquiry is archived (it stops surfacing new matches)."
                              : "no inquiries are affected."}{" "}
                            You can reopen later.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={closeCase}>Close case</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    {conclusion.trim().length === 0 && (
                      <span className="text-muted-foreground text-xs">
                        a conclusion is required to close
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
                  Driving inquiries ({linkedInquiries.length})
                </p>
                {linkedInquiries.length === 0 && (
                  <Card>
                    <CardContent className="text-muted-foreground p-3 text-xs">
                      No inquiry linked — evidence is added manually. Link one below to pull
                      its matches as evidence.
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
                            router.push(`/investigations/inquiries/${q.id}?caseId=${caseId}`)
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
                            aria-label="Edit inquiry query"
                            onClick={() =>
                              router.push(`/investigations/inquiries/${q.id}/edit`)
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
                                aria-label="Unlink inquiry"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Unlink “{q.title}”?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  The inquiry and the evidence already pulled from it are
                                  kept — only the link to this case is removed.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => unlinkInquiry(q.id)}>
                                  Unlink
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
                              router.push(`/investigations/inquiries/${q.id}?caseId=${caseId}`)
                            }
                          >
                            Select matches to pull <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pulling === q.id}
                            onClick={() => pullInquiry(q.id)}
                            title="Pull all current matches"
                          >
                            {pulling === q.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <DownloadCloud className="h-3.5 w-3.5" />
                            )}
                            All
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
                        <SelectValue placeholder="Link another inquiry…" />
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
                      Link
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
                    Recent activity
                  </p>
                  <button
                    className="text-muted-foreground text-xs underline"
                    onClick={() => changeTab("timeline")}
                  >
                    Full timeline
                  </button>
                </div>
                {recentActivity.length === 0 ? (
                  <p className="text-muted-foreground text-xs">No activity yet.</p>
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
            The persisted record of this case — snapshots survive even if the source data
            changes. Pull from the driving inquiry on the Overview tab, or attach findings
            directly.
          </p>
          <EvidenceTable
            evidence={evidence}
            onRemoveEvidence={removeEvidence}
            onRemoveFinding={removeFinding}
            onAddEvidence={() => router.push(`/investigations/${caseId}/evidence/add`)}
            onAddFindings={(assetId) =>
              router.push(`/investigations/${caseId}/evidence/add?assetId=${assetId}`)
            }
            onNoteChange={updateEvidenceNote}
            onFindingNoteChange={updateFindingNote}
          />
        </TabsContent>

        {/* ════ Threads ════ */}
        <TabsContent value="threads">
          <CaseThreads caseId={caseId} evidence={evidence} />
        </TabsContent>

        {/* ════ Timeline ════ */}
        <TabsContent value="timeline">
          <CaseTimeline caseId={caseId} />
        </TabsContent>

        {/* ════ Graph ════ */}
        <TabsContent value="graph">
          <div className="h-[calc(100vh-220px)] min-h-[560px]">
            {graphLoading && nodes.length === 0 ? (
              <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Building graph…
              </div>
            ) : nodes.length > 0 ? (
              <CaseGraphView
                caseId={caseId}
                nodes={nodes}
                edges={edges}
                hypotheses={hypothesisThreads}
                hypothesisColors={hypothesisColors}
                evidence={evidence}
                onReload={reloadAll}
                onMergeExpansion={mergeExpansion}
              />
            ) : (
              <div className="flex h-full items-center justify-center border-2 border-border bg-card">
                <EmptyState
                  title="Empty graph"
                  description="Add evidence to seed the relationship graph."
                />
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
