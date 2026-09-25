"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CircleHelp,
  Download,
  FlaskConical,
  History,
  MoreHorizontal,
  Search,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import type { CaseResponseDto } from "@workspace/api-client";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { CaseStatusBadge } from "@/components/case-status-badge";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { isFindingData } from "../store/projection";
import type { Spotlight } from "../store/ui-store";
import { Presence } from "./presence";

/** The kind glyphs double as the board's legend: the same marks the nodes wear. */
function KindGlyph({ kind }: { kind: Spotlight }) {
  if (kind === "evidence") {
    return (
      <span
        className="size-3 shrink-0 rounded-full border-[1.5px] border-current ring-2 ring-[var(--cb-evidence)] ring-offset-1 ring-offset-transparent"
        aria-hidden
      />
    );
  }
  if (kind === "findings") {
    return <span className="size-2.5 shrink-0 rounded-full bg-[#f5a623] ring-1 ring-current/40" aria-hidden />;
  }
  return <FlaskConical className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />;
}

/**
 * One counter of the top bar's ledger. Pressing it lights every object of
 * its kind on the board and brings them all into view; pressing it again
 * (or Esc, or a click on the empty canvas) lets the rest back.
 */
function Counter({
  kind,
  value,
  label,
  hint,
  active,
  onToggle,
}: {
  kind: Spotlight;
  value: number;
  label: string;
  hint: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={active}
          disabled={value === 0 && !active}
          data-testid={`counter-${kind}`}
          className={cn(
            "group relative flex h-full items-center gap-2 px-3 transition-colors disabled:cursor-default disabled:opacity-45",
            "first:rounded-l-[2px] last:rounded-r-[2px] [&:not(:first-child)]:border-l-2 [&:not(:first-child)]:border-border",
            active ? "bg-foreground text-background" : "enabled:hover:bg-muted",
          )}
        >
          <KindGlyph kind={kind} />
          <span className="font-mono text-[15px] leading-none font-bold tabular-nums">{value}</span>
          <span
            className={cn(
              "hidden font-mono text-[10px] leading-none tracking-[0.12em] uppercase @4xl/topbar:inline",
              active ? "text-background/75" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The board's one-line top bar (PRD §5.1): the case (title, status,
 * severity), a ledger of what is on the board that also spotlights it, the
 * search, who else is here and the overflow menu. The app's breadcrumb is the
 * way back; watches, the save state and every panel live on the right rail.
 */
export function TopBar({
  caseData,
  onTidyUp,
  onTakeSnapshot,
  onExportPng,
}: {
  caseData: CaseResponseDto | null;
  onTidyUp: () => void;
  onTakeSnapshot: () => void;
  onExportPng: () => void;
}) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const store = useBoardStore();
  const rf = useReactFlow();
  const spotlight = useUi((s) => s.spotlight);
  const readOnly = useBoard((s) => s.readOnly);
  const truncated = useBoard((s) => s.truncated);
  const counts = useBoard((s) => {
    let findings = 0;
    for (const b of s.bubbles.values()) findings += b.rows.length;
    let hypotheses = 0;
    for (const item of s.items.values()) if (item.kind === "HYPOTHESIS") hypotheses += 1;
    return `${s.bubbles.size}|${findings}|${hypotheses}`;
  });
  const [evidence, findings, hypotheses] = counts.split("|").map(Number) as [number, number, number];

  const toggle = (kind: Spotlight) => {
    if (spotlight === kind) {
      ui.getState().set({ spotlight: null });
      return;
    }
    ui.getState().set({ spotlight: kind, path: null, pathFrom: null });
    // Bring them all into view. A finding is only drawn near enough, so the
    // assets that carry findings stand in for them when none is on screen.
    const nodes = rf.getNodes().filter((n) => !n.hidden);
    let targets =
      kind === "evidence"
        ? nodes.filter((n) => n.type === "evidence")
        : kind === "hypotheses"
          ? nodes.filter((n) => n.type === "hypothesis")
          : nodes.filter((n) => isFindingData(n.data) && n.data.attached);
    if (kind === "findings" && targets.length === 0) {
      const carriers = new Set(
        [...store.getState().bubbles.values()].filter((b) => b.rows.length > 0).map((b) => b.itemId),
      );
      targets = nodes.filter((n) => carriers.has(n.id));
    }
    if (targets.length === 0) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    void rf.fitView({ nodes: targets.map((n) => ({ id: n.id })), duration: reduced ? 0 : 450, padding: 0.25, maxZoom: 1 });
  };

  return (
    <header
      className="@container/topbar flex h-14 shrink-0 items-center gap-3 border-b-2 border-border bg-background pr-2 pl-4"
      data-testid="board-top-bar"
    >
      <div className="flex min-w-0 shrink items-center gap-2.5">
        <h1
          className="min-w-[4rem] truncate font-serif text-[17px] font-black tracking-[0.03em] uppercase"
          title={caseData?.title}
        >
          {caseData?.title ?? "…"}
        </h1>
        {caseData && <CaseStatusBadge status={caseData.status} />}
        {caseData && (
          <SeverityBadge severity={caseData.severity.toLowerCase() as never}>{caseData.severity}</SeverityBadge>
        )}
        {truncated && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-amber-600/40 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-3" aria-hidden /> {t("caseBoard.truncated")}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{t("caseBoard.truncatedHint")}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div
        role="group"
        aria-label={t("caseBoard.topBar.ledger")}
        className="flex h-9 shrink-0 items-stretch rounded-[4px] border-2 border-border bg-card"
        data-testid="board-ledger"
      >
        <Counter
          kind="evidence"
          value={evidence}
          label={t("caseBoard.topBar.evidence")}
          hint={spotlight === "evidence" ? t("caseBoard.topBar.spotlightClear") : t("caseBoard.topBar.spotlightEvidence")}
          active={spotlight === "evidence"}
          onToggle={() => toggle("evidence")}
        />
        <Counter
          kind="findings"
          value={findings}
          label={t("caseBoard.topBar.findings")}
          hint={spotlight === "findings" ? t("caseBoard.topBar.spotlightClear") : t("caseBoard.topBar.spotlightFindings")}
          active={spotlight === "findings"}
          onToggle={() => toggle("findings")}
        />
        <Counter
          kind="hypotheses"
          value={hypotheses}
          label={t("caseBoard.topBar.hypotheses")}
          hint={
            spotlight === "hypotheses" ? t("caseBoard.topBar.spotlightClear") : t("caseBoard.topBar.spotlightHypotheses")
          }
          active={spotlight === "hypotheses"}
          onToggle={() => toggle("hypotheses")}
        />
      </div>

      <button
        type="button"
        onClick={() => ui.getState().set({ paletteOpen: true })}
        className="group ml-auto flex h-9 w-full max-w-[440px] min-w-[2.25rem] items-center gap-2.5 rounded-[4px] border-2 border-border bg-card px-3 text-left text-sm text-muted-foreground transition-colors hover:border-foreground/50 hover:text-foreground @2xl/topbar:min-w-[220px]"
        data-testid="palette-trigger"
        aria-label={t("caseBoard.topBar.palette")}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden min-w-0 flex-1 truncate @2xl/topbar:inline">{t("caseBoard.topBar.searchPlaceholder")}</span>
        <kbd className="hidden shrink-0 rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground group-hover:text-foreground @2xl/topbar:inline">
          ⌘K
        </kbd>
      </button>

      <Presence />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("caseBoard.topBar.more")}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-[4px] border-2 border-transparent hover:border-border"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem disabled={readOnly} onSelect={onTidyUp}>
            <Wand2 className="size-4" /> {t("caseBoard.topBar.tidyUp")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onExportPng}>
            <Download className="size-4" /> {t("caseBoard.topBar.exportPng")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => ui.getState().openDrawer("snapshots")}>
            <History className="size-4" /> {t("caseBoard.topBar.snapshots")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              onTakeSnapshot();
              toast.success(t("caseBoard.toasts.snapshotTaken"));
            }}
          >
            <Camera className="size-4" /> {t("caseBoard.topBar.takeSnapshot")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => ui.getState().set({ cheatSheetOpen: true })}>
            <CircleHelp className="size-4" /> {t("caseBoard.topBar.cheatSheet")}
          </DropdownMenuItem>
          {!readOnly && (
            <DropdownMenuItem onSelect={() => ui.getState().openDrawer("caseFile")}>
              <CheckCircle2 className="size-4" /> {t("caseBoard.topBar.closeCase")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
