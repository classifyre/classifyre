"use client";

import "@xyflow/react/dist/base.css";
import "./case-board.css";

import * as React from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import { Loader2, Lock, RotateCcw, Route, StickyNote, X } from "lucide-react";
import { toast } from "sonner";
import { api, type CaseLeadDto, type CaseResponseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@workspace/ui/components/resizable";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import { useTranslation } from "@/hooks/use-translation";
import { BoardProviders, useBoard, useBoardStore, useUi, useUiStore } from "./store/board-context";
import { createBoardStore } from "./store/board-store";
import { createUiStore, writePanelWidth } from "./store/ui-store";
import { addNote, combine, moveItems, resetFindingPositions, type Move } from "./store/commands";
import { parseFindingNodeId } from "./store/relations";
import { BoardCanvas, useFlyTo } from "./board-canvas";
import { TopBar } from "./ui/top-bar";
import { CheatSheet } from "./ui/cheat-sheet";
import { CommandPalette } from "./ui/command-palette";
import { BoardDrawers } from "./drawers/board-drawers";
import { PanelRail } from "./ui/panel-rail";
import { useVisibleCentre } from "./hooks/use-visible-centre";
import { primeActorName } from "./hooks/use-actor-name";
import { elkLayout } from "./hooks/elk-layout";
import { layoutBox } from "./hooks/use-auto-place";
import { boardFileName, exportBoardPng } from "./hooks/export-board";
import { useBoardSocket } from "./hooks/use-board-socket";

/** Refetch while visible: worker-side changes (auto-pull) do not push over the socket. */
const POLL_MS = 60_000;

/**
 * The case board (docs/architecture/CASE_BOARD_PRD.md): a full-bleed canvas
 * that *is* the case. Details, hypotheses, timeline, leads, the case file and
 * the evidence table open in a side panel docked beside it (the rail on the
 * right edge), so the canvas shrinks instead of being covered.
 */
export function CaseBoard({ caseId }: { caseId: string }) {
  const [stores] = React.useState(() => {
    primeActorName();
    return { board: createBoardStore(caseId), ui: createUiStore() };
  });
  React.useEffect(() => stores.board.getState().connect(), [stores]);

  return (
    <BoardProviders board={stores.board} ui={stores.ui}>
      <ReactFlowProvider>
        <BoardShell caseId={caseId} />
      </ReactFlowProvider>
    </BoardProviders>
  );
}

/** Fill the viewport below wherever the board starts (app header, banners). */
function useFullBleedHeight(ref: React.RefObject<HTMLDivElement | null>) {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.height = `calc(100dvh - ${Math.max(0, Math.round(top))}px)`;
    };
    apply();
    window.addEventListener("resize", apply);
    const observer = new ResizeObserver(apply);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", apply);
      observer.disconnect();
    };
  }, [ref]);
}

function BoardShell({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const store = useBoardStore();
  const rf = useReactFlow();
  const flyTo = useFlyTo();
  const loaded = useBoard((s) => s.loaded);
  const loadError = useBoard((s) => s.loadError);
  const readOnly = useBoard((s) => s.readOnly);
  const notice = useBoard((s) => s.notice);
  const isEmpty = useBoard((s) => s.items.size === 0);
  const drawer = useUi((s) => s.drawer);
  const ui = useUiStore();
  const rootRef = React.useRef<HTMLDivElement>(null);
  // The width a drag of the panel's edge ended on, saved once the drag is over.
  const panelWidthRef = React.useRef(ui.getState().panelWidth);
  useFullBleedHeight(rootRef);

  const [caseData, setCaseData] = React.useState<CaseResponseDto | null>(null);
  const [leads, setLeads] = React.useState<CaseLeadDto[]>([]);

  const loadCase = React.useCallback(async () => {
    try {
      setCaseData(await api.cases.casesControllerFindOne({ id: caseId }));
    } catch {
      // The board itself reports load errors; the top bar just shows "…".
    }
  }, [caseId]);
  const loadLeads = React.useCallback(async () => {
    try {
      setLeads(await api.cases.caseLeadsControllerList({ caseId }));
    } catch {
      setLeads([]);
    }
  }, [caseId]);

  const refreshAll = React.useCallback(() => {
    store.getState().refetch();
    void loadCase();
    void loadLeads();
  }, [store, loadCase, loadLeads]);

  React.useEffect(() => {
    void store.getState().load();
    void loadCase();
    void loadLeads();
  }, [store, loadCase, loadLeads]);

  // Refetch on focus and every minute while visible (PRD §7.5, multi-replica note).
  React.useEffect(() => {
    const onFocus = () => refreshAll();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") store.getState().refetch();
    }, POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [refreshAll, store]);

  useBoardSocket(caseId);

  React.useEffect(() => {
    if (!notice) return;
    if (notice.kind === "rejected") toast.warning(t("caseBoard.toasts.rejected", { reason: notice.message }));
    else toast.error(t("caseBoard.save.error"), { id: "case-board-save" });
    store.getState().dismissNotice();
  }, [notice, store, t]);

  // The case status can change from the case file drawer; keep the board in step.
  const status = caseData?.status;
  const statusRef = React.useRef(status);
  React.useEffect(() => {
    if (statusRef.current && status && statusRef.current !== status) store.getState().refetch();
    statusRef.current = status;
  }, [status, store]);

  const assistantBridge = React.useMemo(
    () => ({
      contextKey: "case.manage" as const,
      canOpen: true,
      getContext: () => ({
        key: "case.manage" as const,
        route: `/investigations/${caseId}`,
        title: "Case Assistant",
        entityId: caseId,
        values: caseData ? { title: caseData.title, status: caseData.status } : {},
        schema: null,
        validation: { isValid: true, missingFields: [], errors: [] },
        metadata: {},
      }),
      applyAction: () => undefined,
    }),
    [caseData, caseId],
  );
  useRegisterAssistantBridge(assistantBridge);

  const tidyUp = React.useCallback(async () => {
    const s = store.getState();
    const top = [...s.items.values()].filter((i) => !i.parentId && i.x !== null && i.y !== null && i.kind !== "COMMENT");
    if (top.length === 0) return;
    // Tidying also sends dragged findings back to their default spots, so each
    // asset is sized with its findings where they will be afterwards.
    const boxes = new Map(
      top.map((i) => {
        const clean = i.kind === "EVIDENCE" ? { ...i, style: { ...i.style, findingPositions: undefined } } : i;
        return [i.id, layoutBox(s, clean, rf.getInternalNode(i.id)?.measured)] as const;
      }),
    );
    const nodes = top.map((i) => ({ id: i.id, width: boxes.get(i.id)!.width, height: boxes.get(i.id)!.height }));
    // A relation between two findings pulls their assets together; an
    // asset's own findings are inside its box already.
    const ownerOf = (nodeId: string) => parseFindingNodeId(nodeId)?.itemId ?? nodeId;
    const seen = new Set<string>();
    const edges: Array<{ id: string; source: string; target: string }> = [];
    for (const e of rf.getEdges()) {
      if (e.type === "contains") continue;
      const source = ownerOf(e.source);
      const target = ownerOf(e.target);
      const key = `${source}|${target}`;
      if (source === target || !boxes.has(source) || !boxes.has(target) || seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: key, source, target });
    }
    const minX = Math.min(...top.map((i) => i.x! + boxes.get(i.id)!.dx));
    const minY = Math.min(...top.map((i) => i.y! + boxes.get(i.id)!.dy));
    const positions = await elkLayout(nodes, edges, { x: minX, y: minY });
    const moves: Move[] = [];
    for (const item of top) {
      const p = positions.get(item.id);
      if (!p) continue;
      const box = boxes.get(item.id)!;
      moves.push({
        id: item.id,
        from: { x: item.x!, y: item.y! },
        to: { x: Math.round(p.x - box.dx), y: Math.round(p.y - box.dy) },
      });
    }
    const resets = top.map((i) => (i.kind === "EVIDENCE" ? resetFindingPositions(i) : null));
    if (moves.length > 0 || resets.some(Boolean)) {
      s.run(combine(t("caseBoard.topBar.tidyUp"), moves.length > 0 ? moveItems(moves) : null, ...resets));
      toast.success(t("caseBoard.toasts.tidied"));
      requestAnimationFrame(() => void rf.fitView({ duration: 300, padding: 0.15 }));
    }
  }, [store, rf, t]);

  const takeSnapshot = React.useCallback(async () => {
    try {
      await api.caseBoard.caseBoardControllerTakeSnapshot({ id: caseId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [caseId]);

  const exportPng = React.useCallback(async () => {
    try {
      await exportBoardPng(rf.getNodes(), boardFileName(caseData?.title, "png"));
      toast.success(t("caseBoard.toasts.exported"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [rf, caseData, t]);

  return (
    <div
      ref={rootRef}
      className="case-board relative -mx-4 -mt-2 -mb-4 flex min-h-[480px] flex-col overflow-hidden bg-background"
      data-testid="case-board"
    >
      <TopBar
        caseData={caseData}
        onTidyUp={() => void tidyUp()}
        onTakeSnapshot={() => void takeSnapshot()}
        onExportPng={() => void exportPng()}
      />
      {readOnly && (
        <div className="flex items-center gap-2 border-b-2 border-border bg-muted px-3 py-1.5 text-xs" role="status">
          <Lock className="size-3.5" aria-hidden />
          <span>{t("caseBoard.readOnly")}</span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-6 gap-1 px-2 text-xs"
            onClick={async () => {
              // Same as the case page's reopen: back to IN_PROGRESS.
              await api.cases
                .casesControllerUpdate({ id: caseId, updateCaseDto: { status: "IN_PROGRESS" as never } })
                .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));
              refreshAll();
            }}
          >
            <RotateCcw className="size-3" /> {t("caseBoard.reopen")}
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-w-0 flex-1"
          onLayoutChanged={() => {
            if (!ui.getState().drawer) return;
            ui.getState().set({ panelWidth: panelWidthRef.current });
            writePanelWidth(panelWidthRef.current);
          }}
        >
          <ResizablePanel id="canvas" minSize={240}>
            <div className="relative h-full">
              {!loaded ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {t("caseBoard.loading")}
                </div>
              ) : loadError && isEmpty ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
                  <p>{t("caseBoard.loadError")}</p>
                  <p className="max-w-md text-center text-xs text-muted-foreground">{loadError}</p>
                  <Button variant="outline" size="sm" onClick={() => void store.getState().load()}>
                    {t("caseBoard.retry")}
                  </Button>
                </div>
              ) : (
                <>
                  <BoardCanvas onTidyUp={() => void tidyUp()} />
                  {isEmpty && <EmptyBoard />}
                  <PathBanner />
                </>
              )}
            </div>
          </ResizablePanel>
          {drawer && (
            <>
              <ResizableHandle withHandle className="bg-border" />
              <ResizablePanel
                id="panel"
                defaultSize={ui.getState().panelWidth}
                minSize={300}
                maxSize="70%"
                groupResizeBehavior="preserve-pixel-size"
                onResize={(size, _id, prev) => {
                  if (prev) panelWidthRef.current = Math.round(size.inPixels);
                }}
              >
                <BoardDrawers caseId={caseId} caseData={caseData} leads={leads} onChanged={refreshAll} onFlyTo={flyTo} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
        <PanelRail
          pendingLeads={leads.filter((l) => l.status === "PROPOSED").length}
          newMatches={(caseData?.inquiries ?? []).reduce((sum, q) => sum + q.newMatchCount, 0)}
        />
      </div>
      <CommandPalette onFlyTo={flyTo} onTidyUp={() => void tidyUp()} />
      <CheatSheet />
      <ConfirmDialog />
    </div>
  );
}

function EmptyBoard() {
  const { t } = useTranslation();
  const ui = useUiStore();
  const store = useBoardStore();
  const visibleCentre = useVisibleCentre();
  const readOnly = useBoard((s) => s.readOnly);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto w-full max-w-md space-y-3 rounded-[6px] border-2 border-border bg-card p-6 text-center">
        <p className="font-serif text-lg font-black uppercase tracking-[0.03em]">{t("caseBoard.empty.title")}</p>
        <p className="text-sm text-muted-foreground">{t("caseBoard.empty.body")}</p>
        {!readOnly && (
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => ui.getState().openDrawer("inquiries")}>
              {t("caseBoard.empty.linkWatch")}
            </Button>
            <Button size="sm" onClick={() => ui.getState().openDrawer("addEvidence")}>
              {t("caseBoard.empty.addEvidence")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const centre = visibleCentre();
                const cmd = addNote({ x: centre.x - 110, y: centre.y - 80 });
                store.getState().run(cmd);
                ui.getState().set({ editingItemId: cmd.id });
              }}
            >
              <StickyNote className="size-3.5" /> {t("caseBoard.empty.addNote")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PathBanner() {
  const { t } = useTranslation();
  const { path, pathFrom, focusLock } = useUi(
    useShallow((s) => ({ path: s.path, pathFrom: s.pathFrom, focusLock: s.focusLock })),
  );
  const ui = useUiStore();
  if (!path && !pathFrom && !focusLock) return null;
  return (
    <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-[6px] border-2 border-foreground bg-card px-3 py-1.5 text-xs">
      {path ? (
        <>
          <Route className="size-3.5" aria-hidden />
          {t("caseBoard.path.hops", { count: path.hops })}
        </>
      ) : pathFrom ? (
        <>
          <Route className="size-3.5" aria-hidden />
          {t("caseBoard.path.pickTarget")}
        </>
      ) : (
        <>
          <Lock className="size-3.5" aria-hidden />
          {t("caseBoard.focus.locked")}
        </>
      )}
      <button
        type="button"
        className="ml-1 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        onClick={() => ui.getState().set({ path: null, pathFrom: null, focusLock: false })}
      >
        <X className="size-3" /> {path || pathFrom ? t("caseBoard.path.clear") : t("caseBoard.focus.unlock")}
      </button>
    </div>
  );
}

function ConfirmDialog() {
  const { t } = useTranslation();
  const confirm = useUi((s) => s.confirm);
  const ui = useUiStore();
  return (
    <AlertDialog open={!!confirm} onOpenChange={(open) => !open && ui.getState().set({ confirm: null })}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("caseBoard.menu.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={confirm?.destructive ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            onClick={() => {
              const action = confirm?.onConfirm;
              ui.getState().set({ confirm: null });
              void action?.();
            }}
          >
            {confirm?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
