"use client";

import * as React from "react";
import {
  Clock3,
  CloudAlert,
  CloudCheck,
  Loader2,
  Compass,
  FileText,
  History,
  Info,
  FlaskConical,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  SquarePlus,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useUi, useUiStore } from "../store/board-context";
import type { DrawerKind } from "../store/ui-store";

interface RailEntry {
  kind: DrawerKind;
  icon: LucideIcon;
  label: string;
  badge?: number;
  editing?: boolean;
}

/**
 * The strip on the right edge of the board: one button per side panel, and a
 * toggle that folds the panel away or brings back the last one. Clicking the
 * open panel's button closes it too, so the canvas can always have the room.
 */
export function PanelRail({ pendingLeads, newMatches }: { pendingLeads: number; newMatches: number }) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const drawer = useUi((s) => s.drawer);
  const readOnly = useBoard((s) => s.readOnly);
  const last = React.useRef<DrawerKind>("details");
  React.useEffect(() => {
    // Connections only mean something with a trace running: not one to come back to.
    if (drawer && drawer !== "connections") last.current = drawer === "thread" ? "hypotheses" : drawer;
  }, [drawer]);

  const work: RailEntry[] = [
    { kind: "details", icon: Info, label: t("caseBoard.drawers.details") },
    { kind: "hypotheses", icon: FlaskConical, label: t("caseBoard.drawers.hypotheses") },
    { kind: "addEvidence", icon: SquarePlus, label: t("caseBoard.drawers.addEvidence"), editing: true },
  ];
  const caseEntries: RailEntry[] = [
    { kind: "evidence", icon: Paperclip, label: t("caseBoard.drawers.evidence") },
    { kind: "leads", icon: Compass, label: t("caseBoard.drawers.leads"), badge: pendingLeads },
    { kind: "inquiries", icon: Sparkles, label: t("caseBoard.drawers.inquiries"), badge: newMatches },
    { kind: "timeline", icon: Clock3, label: t("caseBoard.drawers.timeline") },
    { kind: "caseFile", icon: FileText, label: t("caseBoard.drawers.caseFile") },
    { kind: "snapshots", icon: History, label: t("caseBoard.drawers.snapshots") },
  ];
  const isActive = (kind: DrawerKind) => drawer === kind || (kind === "hypotheses" && drawer === "thread");
  const toggle = (kind: DrawerKind) => ui.getState().openDrawer(isActive(kind) ? null : kind);

  const button = (entry: RailEntry) => {
    const active = isActive(entry.kind);
    return (
      <Tooltip key={entry.kind}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => toggle(entry.kind)}
            disabled={entry.editing && readOnly}
            aria-pressed={active}
            aria-label={entry.label}
            data-testid={`rail-${entry.kind}`}
            className={cn(
              "relative inline-flex size-8 items-center justify-center rounded-[4px] border-2 transition-colors disabled:opacity-40",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            <entry.icon className="size-4" aria-hidden />
            {entry.badge !== undefined && entry.badge > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-accent px-1 font-mono text-[9px] leading-4 text-accent-foreground">
                {entry.badge > 99 ? "99+" : entry.badge}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{entry.label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <nav
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-l-2 border-border bg-background py-2"
      aria-label={t("caseBoard.rail.label")}
      data-testid="panel-rail"
    >
      {work.map(button)}
      <span className="my-1 h-0.5 w-5 bg-border" aria-hidden />
      {caseEntries.map(button)}
      <SaveState />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => ui.getState().openDrawer(drawer ? null : last.current)}
            aria-label={drawer ? t("caseBoard.rail.collapse") : t("caseBoard.rail.expand")}
            aria-expanded={!!drawer}
            data-testid="rail-toggle"
            className="inline-flex size-8 items-center justify-center rounded-[4px] border-2 border-transparent text-muted-foreground hover:border-border hover:text-foreground"
          >
            {drawer ? <PanelRightClose className="size-4" aria-hidden /> : <PanelRightOpen className="size-4" aria-hidden />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{drawer ? t("caseBoard.rail.collapse") : t("caseBoard.rail.expand")}</TooltipContent>
      </Tooltip>
    </nav>
  );
}

/**
 * Whether the board's edits have reached the server, as one small mark at the
 * foot of the rail: a tick once saved, a spinner while saving, a warning when
 * a save failed. Read-only boards have nothing to save and show nothing.
 */
function SaveState() {
  const { t } = useTranslation();
  const saveState = useBoard((s) => s.saveState);
  const readOnly = useBoard((s) => s.readOnly);
  if (readOnly && saveState !== "saving") return <span className="mt-auto" aria-hidden />;
  const label =
    saveState === "saving"
      ? t("caseBoard.save.saving")
      : saveState === "error"
        ? t("caseBoard.save.error")
        : t("caseBoard.save.saved");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-live="polite"
          aria-label={label}
          data-testid="rail-save-state"
          data-state={saveState}
          className={cn(
            "mt-auto mb-0.5 inline-flex size-8 items-center justify-center",
            saveState === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {saveState === "saving" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : saveState === "error" ? (
            <CloudAlert className="size-4" aria-hidden />
          ) : (
            <CloudCheck className="size-4" aria-hidden />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}
