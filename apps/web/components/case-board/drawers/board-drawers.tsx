"use client";

import * as React from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  Crosshair,
  ExternalLink,
  Eye,
  Loader2,
  MapPin,
  MessageSquare,
  PanelRightClose,
  Plus,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type CaseBoardResponseDto,
  type CaseBoardSnapshotSummaryDto,
  type CaseEventDto,
  type CaseLeadDto,
  type CaseResponseDto,
  type FindingResponseDto,
  type InquiryResponseDto,
} from "@workspace/api-client";
import { Dialog, DialogContent, DialogTitle } from "@workspace/ui/components/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { Textarea } from "@workspace/ui/components/textarea";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
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
import { CaseTimeline } from "@/components/case-timeline";
import { CaseChronology } from "@/components/case-chronology";
import { CaseLeads } from "@/components/case-leads";
import { CaseInquiriesTab } from "@/components/case-inquiries-tab";
import { EvidenceTable } from "@/components/evidence-table";
import { nsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import { BoardProviders, useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { createBoardStore } from "../store/board-store";
import { createUiStore } from "../store/ui-store";
import { addEvidence, attachFinding, placeThread } from "../store/commands";
import { hypothesisMeta } from "../store/selectors";
import { AddEvidencePanel } from "../ui/add-evidence-panel";
import { ThreadPanel } from "./thread-panel";
import { useVisibleCentre } from "../hooks/use-visible-centre";
import { dismissedLabel } from "../store/finding-state";
import type { Bubble, BubbleRow } from "../store/types";
import { BoardCanvas, BOARD_DRAG_MIME } from "../board-canvas";
import { StateChip } from "../ui/state-chip";

const STATUSES = ["OPEN", "IN_PROGRESS"] as const;

const openInTab = (path: string) => window.open(nsPath(path), "_blank", "noopener");

/**
 * The board's side panel (D4, revised): every former case tab, plus details,
 * hypotheses and "add evidence", docked to the right of the canvas. The
 * canvas shrinks beside it instead of being covered, and the rail on the far
 * right, or the close button here, opens and closes it.
 */
export function BoardDrawers({
  caseId,
  caseData,
  leads,
  onChanged,
  onFlyTo,
}: {
  caseId: string;
  caseData: CaseResponseDto | null;
  leads: CaseLeadDto[];
  onChanged: () => void;
  onFlyTo: (itemId: string) => void;
}) {
  const { t } = useTranslation();
  const drawer = useUi((s) => s.drawer);
  const drawerThreadId = useUi((s) => s.drawerThreadId);
  const threadKind = useBoard((s) => (drawerThreadId ? (s.threads.get(drawerThreadId)?.kind ?? null) : null));
  const ui = useUiStore();
  if (!drawer) return null;
  const title =
    drawer === "timeline"
      ? t("caseBoard.drawers.timeline")
      : drawer === "leads"
        ? t("caseBoard.drawers.leads")
        : drawer === "caseFile"
          ? t("caseBoard.drawers.caseFile")
          : drawer === "inquiries"
            ? t("caseBoard.drawers.inquiries")
            : drawer === "evidence"
              ? t("caseBoard.drawers.evidence")
              : drawer === "hypotheses"
                ? t("caseBoard.drawers.hypotheses")
                : drawer === "thread"
                  ? threadKind === "DISCUSSION"
                    ? t("caseBoard.thread.discussion")
                    : t("caseBoard.drawers.hypothesis")
                  : drawer === "addEvidence"
                    ? t("caseBoard.drawers.addEvidence")
                    : drawer === "snapshots"
                      ? t("caseBoard.drawers.snapshots")
                      : t("caseBoard.drawers.details");

  return (
    <aside className="flex h-full min-w-0 flex-col bg-background" aria-label={title} data-testid="board-drawer">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b-2 border-border pl-4 pr-1.5">
        {drawer === "thread" && threadKind !== "DISCUSSION" && (
          <button
            type="button"
            className="-ml-2 inline-flex size-8 items-center justify-center rounded-[4px] hover:bg-muted"
            onClick={() => ui.getState().openDrawer("hypotheses")}
            aria-label={t("caseBoard.drawers.allHypotheses")}
            title={t("caseBoard.drawers.allHypotheses")}
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
        )}
        <h2 className="min-w-0 flex-1 truncate font-serif text-sm font-black uppercase tracking-[0.03em]">{title}</h2>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-[4px] hover:bg-muted"
          onClick={() => ui.getState().openDrawer(null)}
          aria-label={t("caseBoard.drawers.close")}
          title={t("caseBoard.drawers.close")}
          data-testid="board-drawer-close"
        >
          <PanelRightClose className="size-4" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {drawer === "timeline" && <TimelineDrawer caseId={caseId} onFlyTo={onFlyTo} />}
        {drawer === "leads" && <LeadsDrawer caseId={caseId} leads={leads} onChanged={onChanged} />}
        {drawer === "caseFile" && <CaseFileDrawer caseId={caseId} caseData={caseData} onChanged={onChanged} />}
        {drawer === "inquiries" && <InquiriesDrawer caseId={caseId} caseData={caseData} onChanged={onChanged} />}
        {drawer === "evidence" && <EvidenceDrawer caseId={caseId} caseData={caseData} onChanged={onChanged} onFlyTo={onFlyTo} />}
        {drawer === "hypotheses" && <HypothesesDrawer onFlyTo={onFlyTo} />}
        {drawer === "thread" && <ThreadPanel caseId={caseId} onFlyTo={onFlyTo} />}
        {drawer === "details" && <DetailsDrawer onFlyTo={onFlyTo} />}
        {drawer === "addEvidence" && <AddEvidencePanel onFlyTo={onFlyTo} />}
        {drawer === "snapshots" && <SnapshotsDrawer caseId={caseId} />}
      </div>
    </aside>
  );
}

// ─── Hypotheses: every one, on the board or not ───────────────────────────────

function HypothesesDrawer({ onFlyTo }: { onFlyTo: (itemId: string) => void }) {
  const { t } = useTranslation();
  const threads = useBoard((s) => s.threads);
  const readOnly = useBoard((s) => s.readOnly);
  const store = useBoardStore();
  const ui = useUiStore();
  const centre = useVisibleCentre();
  const meta = React.useMemo(() => hypothesisMeta(threads), [threads]);
  const hypotheses = [...threads.values()]
    .filter((th) => th.kind === "HYPOTHESIS")
    .sort((a, b) => (meta.get(a.id)?.index ?? 0) - (meta.get(b.id)?.index ?? 0));
  const discussions = [...threads.values()].filter((th) => th.kind === "DISCUSSION");
  const place = (threadId: string, itemId: string | null) => {
    const at = centre();
    store.getState().run(placeThread(threadId, itemId, { x: at.x - 150, y: at.y - 75 }));
  };
  const newHypothesis = () => {
    const at = centre();
    const pane = document.querySelector<HTMLElement>(".case-board .react-flow")?.getBoundingClientRect();
    ui.getState().set({
      composer: {
        kind: "hypothesis",
        at: { x: at.x - 150, y: at.y - 75 },
        screen: pane ? { x: pane.left + pane.width / 2 - 150, y: pane.top + pane.height / 2 - 60 } : { x: 200, y: 200 },
        anchor: null,
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t("caseBoard.drawers.hypothesesHint")}</p>
        <Button size="sm" className="h-7 shrink-0 gap-1 text-xs" disabled={readOnly} onClick={newHypothesis}>
          <Plus className="size-3" /> {t("caseBoard.drawers.newHypothesis")}
        </Button>
      </div>
      {hypotheses.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("caseBoard.drawers.noHypotheses")}</p>
      ) : (
        <ul className="space-y-1.5">
          {hypotheses.map((th) => {
            const m = meta.get(th.id);
            return (
              <li key={th.id} className="rounded-[4px] border-2 border-border bg-card px-3 py-2" data-testid="hypothesis-row">
                <div className="flex items-start gap-2">
                  <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: m?.color }} aria-hidden />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => ui.getState().openDrawer("thread", { threadId: th.id })}
                  >
                    <span className="mr-1.5 font-mono text-[11px] font-bold">{m?.label}</span>
                    <span className="text-sm font-medium hover:underline">{th.title}</span>
                  </button>
                  {th.status && <StateChip tone="neutral">{th.status}</StateChip>}
                </div>
                <div className="mt-1.5 flex items-center gap-3 pl-[18px] font-mono text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-0.5" title={t("caseBoard.link.supports")}>
                    <Check className="size-3 text-[var(--cb-supports)]" strokeWidth={3} aria-hidden /> {th.supportingCount}
                  </span>
                  <span className="inline-flex items-center gap-0.5" title={t("caseBoard.link.contradicts")}>
                    <X className="size-3 text-[var(--cb-contradicts)]" strokeWidth={3} aria-hidden /> {th.contradictingCount}
                  </span>
                  <span className="inline-flex items-center gap-0.5" title={t("caseBoard.link.neutral")}>
                    <Circle className="size-3" aria-hidden /> {th.neutralCount}
                  </span>
                  <span className="ml-auto flex gap-1">
                    {th.onBoard && th.itemId ? (
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => onFlyTo(th.itemId!)}>
                        <Crosshair className="size-3" /> {t("caseBoard.drawers.showOnBoard")}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        disabled={readOnly}
                        onClick={() => place(th.id, th.itemId)}
                        data-testid="place-hypothesis"
                      >
                        <MapPin className="size-3" /> {t("caseBoard.drawers.placeOnBoard")}
                      </Button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {discussions.length > 0 && (
        <section className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("caseBoard.drawers.discussions")} · {discussions.length}
          </p>
          <ul className="space-y-1">
            {discussions.map((th) => (
              <li key={th.id} className="flex items-center gap-2 rounded-[4px] border border-border px-2.5 py-1.5 text-sm">
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{th.title}</span>
                {th.onBoard && th.itemId ? (
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => onFlyTo(th.itemId!)}>
                    <Crosshair className="size-3" />
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" disabled={readOnly} onClick={() => place(th.id, th.itemId)}>
                    <MapPin className="size-3" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Timeline: activity, chronology, threads ──────────────────────────────────

function TimelineDrawer({ caseId, onFlyTo }: { caseId: string; onFlyTo: (itemId: string) => void }) {
  const { t } = useTranslation();
  const [events, setEvents] = React.useState<CaseEventDto[]>([]);
  const [loadingEvents, setLoadingEvents] = React.useState(true);
  const loadEvents = React.useCallback(async () => {
    setLoadingEvents(true);
    try {
      setEvents(await api.cases.caseEventsControllerList({ caseId }));
    } catch {
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }, [caseId]);
  React.useEffect(() => {
    void loadEvents();
  }, [loadEvents]);
  const store = useBoardStore();
  const showOnBoard = (itemId: string) => {
    // Items removed since the event was recorded have nowhere to fly to.
    if (store.getState().items.has(itemId)) onFlyTo(itemId);
  };

  return (
    <Tabs defaultValue="activity">
      <TabsList className="mb-3 h-8">
        <TabsTrigger value="activity" className="text-xs">{t("caseBoard.drawers.activity")}</TabsTrigger>
        <TabsTrigger value="chronology" className="text-xs">{t("caseBoard.drawers.chronology")}</TabsTrigger>
        <TabsTrigger value="threads" className="text-xs">{t("caseBoard.drawers.threads")}</TabsTrigger>
      </TabsList>
      <TabsContent value="activity">
        <CaseTimeline caseId={caseId} compact onShowOnBoard={showOnBoard} />
      </TabsContent>
      <TabsContent value="chronology">
        <CaseChronology caseId={caseId} events={events} loading={loadingEvents} onChanged={() => void loadEvents()} />
      </TabsContent>
      <TabsContent value="threads">
        <ThreadsOffBoard onFlyTo={onFlyTo} />
      </TabsContent>
    </Tabs>
  );
}

/** Threads with their board presence: place the ones that are not on it. */
function ThreadsOffBoard({ onFlyTo }: { onFlyTo: (itemId: string) => void }) {
  const { t } = useTranslation();
  const threads = useBoard((s) => s.threads);
  const readOnly = useBoard((s) => s.readOnly);
  const store = useBoardStore();
  const centre = useVisibleCentre();
  const list = [...threads.values()];
  if (list.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{t("caseBoard.drawers.noThreads")}</p>;
  const place = (threadId: string, itemId: string | null) => {
    const at = centre();
    store.getState().run(placeThread(threadId, itemId, { x: at.x - 150, y: at.y - 75 }));
  };
  return (
    <ul className="space-y-1.5">
      {list.map((th) => (
        <li key={th.id} className="flex items-center gap-2 rounded-[4px] border-2 border-border bg-card px-3 py-2">
          <StateChip tone={th.kind === "HYPOTHESIS" ? "neutral" : "muted"}>{th.kind === "HYPOTHESIS" ? "H" : "D"}</StateChip>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{th.title}</p>
            <p className="text-[11px] text-muted-foreground">
              {th.entryCount} · {th.lastEntryAt ? formatDistanceToNowStrict(new Date(th.lastEntryAt), { addSuffix: true }) : ""}
              {th.resolvedAt ? ` · ${t("caseBoard.comment.resolved")}` : ""}
            </p>
          </div>
          {th.onBoard && th.itemId ? (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => onFlyTo(th.itemId!)}>
              <Crosshair className="size-3" /> {t("caseBoard.drawers.showOnBoard")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={readOnly} onClick={() => place(th.id, th.itemId)}>
              <MapPin className="size-3" /> {t("caseBoard.drawers.placeOnBoard")}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

// ─── Leads (drag onto the canvas) ─────────────────────────────────────────────

function LeadsDrawer({ caseId, leads, onChanged }: { caseId: string; leads: CaseLeadDto[]; onChanged: () => void }) {
  const { t } = useTranslation();
  const store = useBoardStore();
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("caseBoard.drawers.dragToBoard")}</p>
      <CaseLeads
        caseId={caseId}
        leads={leads}
        loading={false}
        onReviewed={() => {
          onChanged();
          store.getState().refetch();
        }}
        onGenerated={onChanged}
        onLeadDragStart={(lead, event) => {
          event.dataTransfer.setData(
            BOARD_DRAG_MIME,
            JSON.stringify({
              leadId: lead.id,
              entityType: "finding",
              entityId: lead.findingId,
              assetId: lead.assetId ?? null,
              label: lead.title,
            }),
          );
          event.dataTransfer.effectAllowed = "copy";
        }}
      />
    </div>
  );
}

// ─── Case file: status, conclusion, close ────────────────────────────────────

function CaseFileDrawer({
  caseId,
  caseData,
  onChanged,
}: {
  caseId: string;
  caseData: CaseResponseDto | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [conclusion, setConclusion] = React.useState(caseData?.conclusion ?? "");
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setConclusion(caseData?.conclusion ?? ""), [caseData?.conclusion]);
  if (!caseData) return <Loader2 className="size-4 animate-spin" />;
  const closed = caseData.status === "CLOSED" || caseData.status === "ARCHIVED";

  const update = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.cases.casesControllerUpdate({ id: caseId, updateCaseDto: patch as never });
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    try {
      await api.cases.casesControllerClose({ id: caseId, closeCaseDto: { conclusion: conclusion.trim() } });
      toast.success(t("investigations.caseDetail.caseClosed"));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="space-y-5">
      {caseData.description && <p className="text-sm text-muted-foreground">{caseData.description}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <SeverityBadge severity={caseData.severity.toLowerCase() as never}>{caseData.severity}</SeverityBadge>
        {!closed && (
          <Select value={caseData.status} onValueChange={(status) => void update({ status })}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {caseData.assignee && <span className="text-xs text-muted-foreground">{caseData.assignee}</span>}
      </div>
      <section className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {t("investigations.caseDetail.conclusion")}
        </p>
        {closed ? (
          <p className="text-sm whitespace-pre-wrap">{caseData.conclusion || t("investigations.caseDetail.noConclusion")}</p>
        ) : (
          <>
            <Textarea
              rows={6}
              value={conclusion}
              placeholder={t("investigations.caseDetail.conclusionDesc")}
              onChange={(e) => setConclusion(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" disabled={saving} onClick={() => void update({ conclusion })}>
                <Save className="size-3.5" /> {t("investigations.caseDetail.saveDraft")}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" disabled={conclusion.trim().length === 0}>
                    <CheckCircle2 className="size-3.5" /> {t("investigations.caseDetail.closeCase")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("investigations.caseDetail.closeCaseTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("investigations.caseDetail.closeCaseDesc")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void close()}>{t("investigations.caseDetail.closeCase")}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {conclusion.trim().length === 0 && (
                <span className="text-xs text-muted-foreground">{t("investigations.caseDetail.conclusionRequired")}</span>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ─── Watches ─────────────────────────────────────────────────────────────────

function InquiriesDrawer({
  caseId,
  caseData,
  onChanged,
}: {
  caseId: string;
  caseData: CaseResponseDto | null;
  onChanged: () => void;
}) {
  const store = useBoardStore();
  const [all, setAll] = React.useState<InquiryResponseDto[]>([]);
  React.useEffect(() => {
    api.inquiries
      .inquiriesControllerList({ limit: 200 })
      .then((res) => setAll(res.items))
      .catch(() => setAll([]));
  }, []);
  const bubbles = useBoard((s) => s.bubbles);
  const inCase = React.useMemo(() => {
    const ids = new Set<string>();
    for (const b of bubbles.values()) for (const r of b.rows) ids.add(r.findingId);
    return ids;
  }, [bubbles]);
  if (!caseData) return <Loader2 className="size-4 animate-spin" />;
  const linked = caseData.inquiries ?? [];
  const linkedIds = new Set(linked.map((q) => q.id));
  return (
    <CaseInquiriesTab
      caseId={caseId}
      linked={linked}
      linkable={all.filter((q) => !linkedIds.has(q.id) && q.status !== "ARCHIVED")}
      isClosed={caseData.status === "CLOSED" || caseData.status === "ARCHIVED"}
      inCaseFindingIds={inCase}
      onChanged={() => {
        onChanged();
        store.getState().refetch();
      }}
    />
  );
}

// ─── Evidence table (row → fly to the bubble) ─────────────────────────────────

function EvidenceDrawer({
  caseId,
  caseData,
  onChanged,
  onFlyTo,
}: {
  caseId: string;
  caseData: CaseResponseDto | null;
  onChanged: () => void;
  onFlyTo: (itemId: string) => void;
}) {
  const store = useBoardStore();
  const ui = useUiStore();
  const bubbles = useBoard((s) => s.bubbles);
  const itemByEvidence = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bubbles.values()) map.set(b.evidenceId, b.itemId);
    return map;
  }, [bubbles]);
  if (!caseData) return <Loader2 className="size-4 animate-spin" />;
  const refresh = () => {
    onChanged();
    store.getState().refetch();
  };
  return (
    <EvidenceTable
      evidence={caseData.evidence ?? []}
      onRemoveEvidence={async (evidenceId) => {
        await api.cases.casesControllerRemoveEvidence({ id: caseId, evidenceId });
        refresh();
      }}
      onRemoveFinding={async (caseFindingId) => {
        await api.cases.casesControllerRemoveFinding({ id: caseId, caseFindingId });
        refresh();
      }}
      onAddEvidence={() => ui.getState().set({ paletteOpen: true })}
      onAddFindings={(assetId) => {
        const itemId = store.getState().itemByAsset.get(assetId);
        if (itemId) {
          ui.getState().toggle("expandedUnattached", itemId);
          onFlyTo(itemId);
        }
      }}
      onNoteChange={async (evidenceId, note) => {
        await api.cases.casesControllerPatchEvidenceNote({ id: caseId, evidenceId, updateEvidenceNoteDto: { note: note || undefined } });
      }}
      onFindingNoteChange={async (caseFindingId, note) => {
        await api.cases.casesControllerPatchFindingNote({ id: caseId, caseFindingId, updateCaseFindingNoteDto: { note: note || undefined } });
      }}
      onOpenEvidence={(evidenceId) => {
        const itemId = itemByEvidence.get(evidenceId);
        if (itemId) onFlyTo(itemId);
      }}
    />
  );
}

// ─── Details of a bubble or a finding row ─────────────────────────────────────

function DetailsDrawer({ onFlyTo }: { onFlyTo: (itemId: string) => void }) {
  const { t } = useTranslation();
  const target = useUi((s) => s.detailsTarget);
  if (!target) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("caseBoard.drawers.detailsEmpty")}</p>;
  }
  if ("suggestedKey" in target) return <SuggestedDetails suggestedKey={target.suggestedKey} />;
  return <ItemDetails itemId={target.itemId} findingId={target.findingId ?? null} onFlyTo={onFlyTo} />;
}

/** A neighbour that is not in the case yet: what it is, and the way in. */
function SuggestedDetails({ suggestedKey }: { suggestedKey: string }) {
  const { t } = useTranslation();
  const suggestion = useBoard((s) => s.suggested.get(suggestedKey));
  const readOnly = useBoard((s) => s.readOnly);
  const store = useBoardStore();
  const rf = useReactFlow();
  if (!suggestion) return <p className="py-8 text-center text-sm text-muted-foreground">{t("caseBoard.drawers.detailsEmpty")}</p>;
  const add = () => {
    const node = rf.getNode(suggestedKey);
    store.getState().run(
      addEvidence({ entityType: "asset", entityId: suggestion.assetId }, node ? node.position : null, {
        label: suggestion.label,
        assetType: suggestion.assetType,
        sourceType: suggestion.sourceType,
      }),
    );
  };
  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {suggestion.assetType ?? "asset"} {suggestion.sourceName ? `· ${suggestion.sourceName}` : ""}
        </p>
        <p className="font-semibold">{suggestion.label}</p>
        <p className="text-xs text-muted-foreground">{t("caseBoard.suggested.hint")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="h-7 gap-1 text-xs" disabled={readOnly} onClick={add}>
          <Plus className="size-3" /> {t("caseBoard.suggested.add")}
        </Button>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openInTab(`/assets/${suggestion.assetId}`)}>
          <ExternalLink className="size-3" /> {t("caseBoard.menu.openAsset")}
        </Button>
      </div>
    </div>
  );
}

function ItemDetails({
  itemId,
  findingId,
  onFlyTo,
}: {
  itemId: string;
  findingId: string | null;
  onFlyTo: (itemId: string) => void;
}) {
  const { t } = useTranslation();
  const bubble = useBoard((s) => s.bubbles.get(itemId));
  const [finding, setFinding] = React.useState<FindingResponseDto | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!findingId) {
      setFinding(null);
      return;
    }
    setLoading(true);
    api.findings
      .findingsControllerFindOne({ id: findingId })
      .then(setFinding)
      .catch(() => setFinding(null))
      .finally(() => setLoading(false));
  }, [findingId]);

  if (!bubble) return <p className="py-8 text-center text-sm text-muted-foreground">{t("caseBoard.drawers.detailsEmpty")}</p>;
  const row = findingId ? [...bubble.rows, ...bubble.unattached].find((r) => r.findingId === findingId) : undefined;

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {bubble.assetType ?? "asset"} {bubble.sourceName ? `· ${bubble.sourceName}` : ""}
        </p>
        <p className="font-semibold">{bubble.label}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => onFlyTo(bubble.itemId)}>
            <Crosshair className="size-3" /> {t("caseBoard.drawers.showOnBoard")}
          </Button>
          {bubble.assetId && (
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openInTab(`/assets/${bubble.assetId}`)}>
              <ExternalLink className="size-3" /> {t("caseBoard.menu.openAsset")}
            </Button>
          )}
        </div>
      </div>
      <FindingList itemId={bubble.itemId} bubble={bubble} selectedId={findingId} />
      {findingId && (
        <div className="space-y-2 border-t-2 border-border pt-3">
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={(row?.severity ?? finding?.severity?.toLowerCase() ?? "info") as never}>
                  {row?.severity ?? finding?.severity}
                </SeverityBadge>
                <span className="font-medium">{row?.typeLabel ?? finding?.findingType}</span>
                {row && row.state !== "open" && <StateChip tone="neutral">{row.state}</StateChip>}
              </div>
              <pre className="max-h-56 overflow-auto rounded-[4px] border-2 border-border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
                {finding?.contextBefore ? <span className="text-muted-foreground">{finding.contextBefore}</span> : null}
                <mark className="bg-accent text-accent-foreground">{finding?.matchedContent ?? row?.value ?? ""}</mark>
                {finding?.contextAfter ? <span className="text-muted-foreground">{finding.contextAfter}</span> : null}
              </pre>
              <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Detector</dt>
                <dd>{finding?.customDetectorName ?? finding?.detectorType ?? row?.detector ?? "—"}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{finding?.status ?? row?.status ?? "—"}</dd>
                {finding?.detectedAt && (
                  <>
                    <dt className="text-muted-foreground">Detected</dt>
                    <dd>{new Date(finding.detectedAt).toLocaleString()}</dd>
                  </>
                )}
                {row?.note && (
                  <>
                    <dt className="text-muted-foreground">Note</dt>
                    <dd className="whitespace-pre-wrap">{row.note}</dd>
                  </>
                )}
              </dl>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openInTab(`/findings/${findingId}`)}>
                <ExternalLink className="size-3" /> {t("caseBoard.menu.openFinding")}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Every finding of the asset, as a list: the board draws them as nodes around
 * the asset (up to a dozen at a time), and this is where they all read as
 * text, with Attach for the ones not yet in the case.
 */
function FindingList({
  itemId,
  bubble,
  selectedId,
}: {
  itemId: string;
  bubble: Bubble;
  selectedId: string | null;
}) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const store = useBoardStore();
  const readOnly = useBoard((s) => s.readOnly);
  const highlights = useBoard((s) => s.items.get(itemId)?.style.rowHighlights);
  const select = (findingId: string) => ui.getState().set({ detailsTarget: { itemId, findingId } });
  const line = (row: BubbleRow, attached: boolean) => (
    <li key={row.findingId}>
      <div
        className={cn(
          "flex w-full items-center gap-1.5 rounded-[3px] px-1.5 py-1 text-left text-[11px] hover:bg-muted/70",
          row.findingId === selectedId && "bg-muted",
          highlights?.[row.findingId] && `cb-row-${highlights[row.findingId]}`,
          !attached && "text-muted-foreground",
        )}
      >
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => select(row.findingId)}>
          <SeverityBadge severity={row.severity ?? "info"} className="w-[46px] shrink-0 justify-center px-0.5 py-px text-[8px]">
            {t(`caseBoard.severity.${row.severity ?? "info"}`)}
          </SeverityBadge>
          <span className="max-w-[110px] shrink-0 truncate text-muted-foreground">{row.typeLabel}</span>
          <span className={cn("min-w-0 flex-1 truncate font-mono", row.state === "dismissed" && "line-through")}>
            {row.value ?? ""}
          </span>
          {row.state !== "open" && (
            <StateChip tone={row.state === "resolved" ? "success" : row.state === "new" ? "accent" : row.state === "gone" ? "destructive" : "muted"}>
              {row.state === "dismissed" ? t(`caseBoard.states.${dismissedLabel(row.status)}`) : t(`caseBoard.states.${row.state}`)}
            </StateChip>
          )}
        </button>
        {!attached && !readOnly && (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-0.5 rounded-[3px] border border-border px-1 py-px font-mono text-[9px] uppercase text-foreground hover:bg-muted"
            title={t("caseBoard.bubble.attachHint")}
            onClick={() => store.getState().run(attachFinding(itemId, row.findingId))}
          >
            <Plus className="size-2.5" aria-hidden />
            {t("caseBoard.bubble.attach")}
          </button>
        )}
      </div>
    </li>
  );
  if (bubble.rows.length === 0 && bubble.unattached.length === 0) return null;
  return (
    <div className="space-y-2 border-t-2 border-border pt-3">
      {bubble.rows.length > 0 && (
        <section className="space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("caseBoard.bubble.findings")} · {bubble.rows.length}
          </p>
          <ul className="max-h-64 overflow-y-auto">{bubble.rows.map((row) => line(row, true))}</ul>
        </section>
      )}
      {bubble.unattached.length > 0 && (
        <section className="space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("caseBoard.bubble.notInCase")} · {bubble.unattached.length}
          </p>
          <ul className="max-h-48 overflow-y-auto">{bubble.unattached.map((row) => line(row, false))}</ul>
        </section>
      )}
    </div>
  );
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

function SnapshotsDrawer({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const [list, setList] = React.useState<CaseBoardSnapshotSummaryDto[] | null>(null);
  const [viewing, setViewing] = React.useState<{ id: string; createdAt: Date; payload: CaseBoardResponseDto } | null>(null);
  React.useEffect(() => {
    api.caseBoard
      .caseBoardControllerListSnapshots({ id: caseId })
      .then(setList)
      .catch(() => setList([]));
  }, [caseId]);
  const open = async (id: string) => {
    try {
      const snap = await api.caseBoard.caseBoardControllerGetSnapshot({ id: caseId, snapshotId: id });
      setViewing({ id: snap.id, createdAt: snap.createdAt, payload: snap.payload });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  if (!list) return <Loader2 className="size-4 animate-spin" />;
  return (
    <>
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("caseBoard.drawers.noSnapshots")}</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((snap, index) => (
            <li key={snap.id} className="flex items-center gap-3 rounded-[4px] border-2 border-border bg-card px-3 py-2">
              <span className="font-mono text-xs text-muted-foreground">#{list.length - index}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {snap.reason === "CASE_CLOSED"
                    ? t("caseBoard.drawers.snapshotReason.CASE_CLOSED")
                    : t("caseBoard.drawers.snapshotReason.MANUAL")}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(snap.createdAt).toLocaleString()} · v{snap.version}
                  {snap.createdBy ? ` · ${snap.createdBy}` : ""}
                </p>
              </div>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => void open(snap.id)}>
                <Eye className="size-3" /> {t("caseBoard.drawers.viewSnapshot")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {viewing && (
        <SnapshotViewer caseId={caseId} snapshot={viewing} onClose={() => setViewing(null)} />
      )}
    </>
  );
}

/** A frozen board: the same canvas over a store hydrated from the snapshot, read-only. */
function SnapshotViewer({
  caseId,
  snapshot,
  onClose,
}: {
  caseId: string;
  snapshot: { id: string; createdAt: Date; payload: CaseBoardResponseDto };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [stores] = React.useState(() => {
    const board = createBoardStore(caseId);
    board.getState().hydrate(snapshot.payload);
    board.setState({ readOnly: true });
    return { board, ui: createUiStore() };
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <div className="flex items-center gap-2 border-b-2 border-border px-4 py-2">
          <DialogTitle className="text-sm font-semibold">
            {t("caseBoard.drawers.snapshotView", { date: new Date(snapshot.createdAt).toLocaleString() })}
          </DialogTitle>
          <Button variant="ghost" size="sm" className="ml-auto mr-8 h-7 text-xs" onClick={onClose}>
            {t("caseBoard.drawers.backToBoard")}
          </Button>
        </div>
        <div className="case-board relative min-h-0 flex-1">
          <BoardProviders board={stores.board} ui={stores.ui}>
            <ReactFlowProvider>
              <BoardCanvas onTidyUp={() => undefined} />
            </ReactFlowProvider>
          </BoardProviders>
        </div>
      </DialogContent>
    </Dialog>
  );
}
