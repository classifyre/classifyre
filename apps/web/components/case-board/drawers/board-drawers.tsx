"use client";

import * as React from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowLeft,
  Check,
  Circle,
  Crosshair,
  Eye,
  FlaskConical,
  Loader2,
  MapPin,
  MessageSquare,
  PanelRightClose,
  Plus,
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
} from "@workspace/api-client";
import { Dialog, DialogContent, DialogTitle } from "@workspace/ui/components/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { StateChip } from "@workspace/case-board/components/state-chip";
import { CaseTimeline } from "@/components/case-timeline";
import { CaseChronology } from "@/components/case-chronology";
import { CaseLeads } from "@/components/case-leads";
import { CaseInquiriesTab } from "@/components/case-inquiries-tab";
import { EvidenceTable } from "@/components/evidence-table";
import { CaseTargetProvider } from "@/components/case-target/case-target";
import { useTranslation } from "@/hooks/use-translation";
import { BoardProviders, useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { createBoardStore } from "../store/board-store";
import { createUiStore, type DrawerKind, type TimelineView } from "../store/ui-store";
import { EMPTY_URL_STATE, withBoardUrl } from "../store/url-state";
import { CaseFilePanel } from "./case-file-panel";
import { DetailsPanel } from "./details-panel";
import { useBoardCaseTarget } from "../hooks/use-board-case-target";
import { useTimelineLink } from "../hooks/use-timeline-link";
import { usePlaceEvidence } from "../hooks/use-place-evidence";
import { placeThread } from "../store/commands";
import { hypothesisMeta, type EvidenceCandidate } from "../store/selectors";
import { AddEvidencePanel } from "../ui/add-evidence-panel";
import { ThreadPanel, VERDICTS } from "./thread-panel";
import { ConnectionsPanel } from "./connections-panel";
import type { CaseLeads as CaseLeadsState } from "../hooks/use-case-leads";
import { locateLead } from "../store/leads";
import { useVisibleCentre } from "../hooks/use-visible-centre";
import type { Bubble } from "../store/types";
import { BoardCanvas, BOARD_DRAG_MIME } from "../board-canvas";

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
  onCaseChanged,
  onFlyTo,
}: {
  caseId: string;
  caseData: CaseResponseDto | null;
  leads: CaseLeadsState;
  /** Something the board shows changed: refetch the board, the case and the leads. */
  onChanged: () => void;
  /** Only the case's own fields changed: reread the case. */
  onCaseChanged: () => void;
  onFlyTo: (itemId: string) => void;
}) {
  const { t } = useTranslation();
  const drawer = useUi((s) => s.drawer);
  const drawerThreadId = useUi((s) => s.drawerThreadId);
  const threadKind = useBoard((s) => (drawerThreadId ? (s.threads.get(drawerThreadId)?.kind ?? null) : null));
  const ui = useUiStore();
  // Everything the panel offers to add (graphs, similar findings…) goes into this case.
  const caseTarget = useBoardCaseTarget(onFlyTo);
  if (!drawer) return null;
  const titles: Record<DrawerKind, string> = {
    details: t("caseBoard.drawers.details"),
    hypotheses: t("caseBoard.drawers.hypotheses"),
    thread: threadKind === "DISCUSSION" ? t("caseBoard.thread.discussion") : t("caseBoard.drawers.hypothesis"),
    addEvidence: t("caseBoard.drawers.addEvidence"),
    connections: t("caseBoard.drawers.connections"),
    evidence: t("caseBoard.drawers.evidence"),
    leads: t("caseBoard.drawers.leads"),
    inquiries: t("caseBoard.drawers.inquiries"),
    timeline: t("caseBoard.drawers.timeline"),
    caseFile: t("caseBoard.drawers.caseFile"),
    snapshots: t("caseBoard.drawers.snapshots"),
  };
  const title = titles[drawer];

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
      <CaseTargetProvider value={caseTarget}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {drawer === "timeline" && <TimelineDrawer caseId={caseId} caseData={caseData} onFlyTo={onFlyTo} />}
        {drawer === "leads" && <LeadsDrawer leads={leads} onFlyTo={onFlyTo} />}
        {drawer === "caseFile" && (
          <CaseFilePanel caseId={caseId} caseData={caseData} onChanged={onChanged} onCaseChanged={onCaseChanged} />
        )}
        {drawer === "inquiries" && <InquiriesDrawer caseId={caseId} caseData={caseData} onChanged={onChanged} />}
        {drawer === "evidence" && <EvidenceDrawer caseId={caseId} caseData={caseData} onChanged={onChanged} onFlyTo={onFlyTo} />}
        {drawer === "hypotheses" && <HypothesesDrawer onFlyTo={onFlyTo} />}
        {drawer === "thread" && <ThreadPanel caseId={caseId} onFlyTo={onFlyTo} />}
        {drawer === "details" && <DetailsPanel onFlyTo={onFlyTo} />}
        {drawer === "addEvidence" && <AddEvidencePanel onFlyTo={onFlyTo} />}
        {drawer === "connections" && <ConnectionsPanel onFlyTo={onFlyTo} />}
        {drawer === "snapshots" && <SnapshotsDrawer caseId={caseId} />}
      </div>
      </CaseTargetProvider>
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
  const ruled = hypotheses.filter((th) => th.status === "SUPPORTED" || th.status === "REFUTED").length;

  return (
    <div className="space-y-5" data-testid="hypotheses-panel">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-bold tabular-nums">
            {hypotheses.length === 1
              ? t("caseBoard.hypothesesList.countOne")
              : t("caseBoard.hypothesesList.count", { count: hypotheses.length })}
          </p>
          <p className="text-xs text-muted-foreground">
            {hypotheses.length > 0
              ? t("caseBoard.hypothesesList.ruled", { count: ruled })
              : t("caseBoard.drawers.hypothesesHint")}
          </p>
        </div>
        <Button size="sm" className="h-8 shrink-0 gap-1" disabled={readOnly} onClick={newHypothesis}>
          <Plus className="size-3.5" strokeWidth={3} /> {t("caseBoard.drawers.newHypothesis")}
        </Button>
      </div>

      {hypotheses.length === 0 ? (
        <div className="rounded-[4px] border-2 border-dashed border-border px-4 py-8 text-center">
          <FlaskConical className="mx-auto size-6 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm font-medium">{t("caseBoard.drawers.noHypotheses")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("caseBoard.hypothesesList.emptyHint")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {hypotheses.map((th) => {
            const m = meta.get(th.id);
            const verdict = VERDICTS.find((v) => v.value === (th.status ?? "PROPOSED")) ?? VERDICTS[0]!;
            const total = th.supportingCount + th.contradictingCount + th.neutralCount;
            const onBoard = th.onBoard && !!th.itemId;
            return (
              <li
                key={th.id}
                className={cn(
                  "group relative overflow-hidden rounded-[4px] border-2 bg-card transition-colors hover:border-foreground/40",
                  onBoard ? "border-border" : "border-dashed border-border",
                )}
                data-testid="hypothesis-row"
              >
                <span className="absolute inset-y-0 left-0 w-1" style={{ background: m?.color }} aria-hidden />
                <button
                  type="button"
                  className="block w-full py-2.5 pr-3 pl-4 text-left"
                  onClick={() => ui.getState().openDrawer("thread", { threadId: th.id })}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] leading-none font-bold text-white"
                      style={{ background: m?.color }}
                    >
                      {m?.label}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 font-mono text-[10px] font-bold tracking-[0.06em] uppercase"
                      style={{ color: verdict.value === "PROPOSED" ? undefined : verdict.tone }}
                    >
                      <verdict.icon className="size-3" strokeWidth={3} aria-hidden />
                      {t(`caseBoard.hypothesis.status.${verdict.value}`)}
                    </span>
                    <span className="flex-1" />
                    {th.confidence !== null && (
                      <span className="font-mono text-[11px] text-muted-foreground tabular-nums" title={t("caseBoard.hypothesis.confidence")}>
                        {Math.round(th.confidence * 100)}%
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 line-clamp-2 block text-sm leading-snug font-semibold">{th.title}</span>
                  <span className="mt-2 flex items-center gap-3">
                    <span className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      {total > 0 && (
                        <>
                          <span style={{ width: `${(th.supportingCount / total) * 100}%`, background: "var(--cb-supports)" }} />
                          <span style={{ width: `${(th.contradictingCount / total) * 100}%`, background: "var(--cb-contradicts)" }} />
                          <span style={{ width: `${(th.neutralCount / total) * 100}%`, background: "var(--muted-foreground)" }} />
                        </>
                      )}
                    </span>
                    <span className="flex shrink-0 gap-2 font-mono text-[11px] tabular-nums">
                      <span className="inline-flex items-center gap-0.5" title={t("caseBoard.link.supports")}>
                        <Check className="size-3 text-[var(--cb-supports)]" strokeWidth={3} aria-hidden /> {th.supportingCount}
                      </span>
                      <span className="inline-flex items-center gap-0.5" title={t("caseBoard.link.contradicts")}>
                        <X className="size-3 text-[var(--cb-contradicts)]" strokeWidth={3} aria-hidden /> {th.contradictingCount}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-muted-foreground" title={t("caseBoard.link.neutral")}>
                        <Circle className="size-3" aria-hidden /> {th.neutralCount}
                      </span>
                    </span>
                  </span>
                </button>
                <div className="flex items-center gap-2 border-t border-border py-1.5 pr-1.5 pl-4 text-[11px] text-muted-foreground">
                  <MessageSquare className="size-3 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {th.entryCount === 1
                      ? t("caseBoard.hypothesesList.entriesOne")
                      : t("caseBoard.hypothesesList.entries", { count: th.entryCount })}
                    {th.lastEntryAt
                      ? ` · ${formatDistanceToNowStrict(new Date(th.lastEntryAt), { addSuffix: true })}${th.lastAuthor ? ` · ${th.lastAuthor}` : ""}`
                      : ""}
                  </span>
                  {onBoard ? (
                    <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => onFlyTo(th.itemId!)}>
                      <Crosshair className="size-3" /> {t("caseBoard.drawers.showOnBoard")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 gap-1 px-1.5 text-[11px]"
                      disabled={readOnly}
                      onClick={() => place(th.id, th.itemId)}
                      data-testid="place-hypothesis"
                    >
                      <MapPin className="size-3" /> {t("caseBoard.drawers.placeOnBoard")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {discussions.length > 0 && (
        <section className="space-y-2">
          <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
            {t("caseBoard.drawers.discussions")} · {discussions.length}
          </p>
          <ul className="space-y-1">
            {discussions.map((th) => (
              <li key={th.id} className="flex items-center gap-2 rounded-[4px] border-2 border-border bg-card py-1 pr-1 pl-2.5">
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                  onClick={() => ui.getState().openDrawer("thread", { threadId: th.id })}
                >
                  {th.title}
                </button>
                {th.resolvedAt && <StateChip tone="success">{t("caseBoard.comment.resolved")}</StateChip>}
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">{th.entryCount}</span>
                {th.onBoard && th.itemId ? (
                  <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => onFlyTo(th.itemId!)} aria-label={t("caseBoard.drawers.showOnBoard")}>
                    <Crosshair className="size-3" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5"
                    disabled={readOnly}
                    onClick={() => place(th.id, th.itemId)}
                    aria-label={t("caseBoard.drawers.placeOnBoard")}
                  >
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

function TimelineDrawer({
  caseId,
  caseData,
  onFlyTo,
}: {
  caseId: string;
  caseData: CaseResponseDto | null;
  onFlyTo: (itemId: string) => void;
}) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const view = useUi((s) => s.timelineView);
  const focus = useUi((s) => s.timelineFocus);
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
  const watches = React.useMemo(
    () => (caseData?.inquiries ?? []).map((q) => ({ id: q.id, title: q.title })),
    [caseData?.inquiries],
  );

  return (
    <Tabs value={view} onValueChange={(value) => ui.getState().set({ timelineView: value as TimelineView })}>
      <TabsList className="mb-3 h-8">
        <TabsTrigger value="activity" className="text-xs">{t("caseBoard.drawers.activity")}</TabsTrigger>
        <TabsTrigger value="chronology" className="text-xs">{t("caseBoard.drawers.chronology")}</TabsTrigger>
        <TabsTrigger value="threads" className="text-xs">{t("caseBoard.drawers.threads")}</TabsTrigger>
      </TabsList>
      <TabsContent value="activity">
        <CaseTimeline
          caseId={caseId}
          compact
          onShowOnBoard={showOnBoard}
          watches={watches}
          focusEntryId={focus?.entryId ?? null}
          focusNonce={focus?.nonce ?? 0}
          onFocusEntry={(entryId) => ui.getState().focusTimeline(entryId)}
          entryLink={(entryId) =>
            withBoardUrl(window.location.href, { ...EMPTY_URL_STATE, panel: "timeline", entryId })
          }
        />
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

// ─── Leads (accept, dismiss, or drag onto the canvas) ─────────────────────────

function LeadsDrawer({ leads, onFlyTo }: { leads: CaseLeadsState; onFlyTo: (itemId: string) => void }) {
  const store = useBoardStore();
  const ui = useUiStore();
  const readOnly = useBoard((s) => s.readOnly);
  const place = usePlaceEvidence(onFlyTo);
  // Read so the panel follows the board: "Show on board" and "in case" follow
  // what is on it.
  useBoard((s) => s.itemByAsset);
  useBoard((s) => s.bubbles);
  const dragData = (lead: CaseLeadDto, event: React.DragEvent, withLead: boolean) => {
    event.dataTransfer.setData(
      BOARD_DRAG_MIME,
      JSON.stringify({
        // A waiting lead is accepted where it lands; a reviewed one just adds
        // what it points at (its review stays as it was).
        ...(withLead ? { leadId: lead.id } : {}),
        entityType: lead.kind === "ASSET" ? "asset" : "finding",
        entityId: lead.findingId ?? lead.assetId,
        assetId: lead.assetId ?? null,
        label: lead.kind === "ASSET" ? (lead.assetName ?? lead.title) : (lead.assetName ?? lead.title),
        assetType: lead.assetType ?? null,
        sourceType: lead.sourceType ?? null,
      }),
    );
    event.dataTransfer.effectAllowed = "copy";
  };
  return (
    <CaseLeads
      leads={leads.leads}
      loading={leads.loading}
      readOnly={readOnly}
      busy={leads.busy}
      refreshing={leads.refreshing}
      onAccept={(lead) => void leads.accept(lead)}
      onDismiss={(ids, reason) => void leads.dismiss(ids, reason)}
      onRefresh={() => void leads.refresh()}
      onShowOnBoard={leads.showOnBoard}
      canShowOnBoard={(lead) => locateLead(store.getState().itemByAsset, lead) !== null}
      onOpenWatch={(inquiryId) => ui.getState().openDrawer("inquiries", { watchId: inquiryId })}
      onLeadDragStart={(lead, event) => dragData(lead, event, true)}
      isInCase={(lead) => leadInCase(store.getState(), lead)}
      onReviewedDragStart={(lead, event) => dragData(lead, event, false)}
      onAddReviewed={(lead) => {
        const target = leadTarget(lead);
        if (target) place(target);
      }}
    />
  );
}

/** Whether what a lead points at is in the case now: its finding attached, or its asset evidence. */
function leadInCase(s: { itemByAsset: ReadonlyMap<string, string>; itemByFinding: ReadonlyMap<string, string>; bubbles: ReadonlyMap<string, Bubble> }, lead: CaseLeadDto): boolean {
  if (lead.findingId) {
    const itemId = s.itemByFinding.get(lead.findingId);
    return !!itemId && !!s.bubbles.get(itemId)?.rows.some((r) => r.findingId === lead.findingId);
  }
  return !!lead.assetId && s.itemByAsset.has(lead.assetId);
}

/** What a lead points at, as something to put on the board. */
function leadTarget(lead: CaseLeadDto): EvidenceCandidate | null {
  if (!lead.assetId) return null;
  return {
    kind: lead.findingId ? "finding" : "asset",
    id: lead.findingId ?? lead.assetId,
    assetId: lead.assetId,
    assetName: lead.assetName ?? lead.title,
    assetType: lead.assetType ?? null,
    sourceType: lead.sourceType ?? null,
  };
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
  const ui = useUiStore();
  const watchId = useUi((s) => s.watchId);
  const openTimeline = useTimelineLink();
  const bubbles = useBoard((s) => s.bubbles);
  const threads = useBoard((s) => s.threads);
  const inCase = React.useMemo(() => {
    const ids = new Set<string>();
    for (const b of bubbles.values()) for (const r of b.rows) ids.add(r.findingId);
    return ids;
  }, [bubbles]);
  // The case's hypotheses with their board labels (H1, H2, …) and colours.
  const hypotheses = React.useMemo(() => {
    const meta = hypothesisMeta(threads);
    return [...threads.values()]
      .filter((th) => th.kind === "HYPOTHESIS")
      .map((th) => ({
        id: th.id,
        title: th.title,
        label: meta.get(th.id)?.label ?? "H",
        color: meta.get(th.id)?.color ?? "#888",
        status: th.status,
      }));
  }, [threads]);
  if (!caseData) return <Loader2 className="size-4 animate-spin" />;
  return (
    <CaseInquiriesTab
      caseId={caseId}
      linked={caseData.inquiries ?? []}
      isClosed={caseData.status === "CLOSED" || caseData.status === "ARCHIVED"}
      inCaseFindingIds={inCase}
      filters={caseData.findingFilters ?? []}
      hypothesisRules={caseData.hypothesisRules ?? []}
      hypotheses={hypotheses}
      clientId={store.getState().clientId}
      selectedId={watchId}
      onSelect={(inquiryId) => ui.getState().set({ watchId: inquiryId })}
      onOpenHistory={(request, fallback) =>
        void openTimeline(
          request.kind === "settings"
            ? {
                types: ["INQUIRY_SETTINGS_UPDATED", "INQUIRY_PULLED", "INQUIRY_LINKED", "FINDING_FILTER_ADDED"],
                inquiryId: request.inquiryId,
              }
            : {
                watchTypes: [request.kind === "landed" ? "MATCHES_LANDED" : "MATCHES_RETIRED"],
                inquiryIds: request.inquiryIds,
              },
          { fallback },
        )
      }
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
              <BoardCanvas onTidyUp={() => undefined} rememberViewport={false} />
            </ReactFlowProvider>
          </BoardProviders>
        </div>
      </DialogContent>
    </Dialog>
  );
}
