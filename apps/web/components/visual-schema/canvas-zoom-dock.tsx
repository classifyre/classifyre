"use client";

import * as React from "react";
import { useReactFlow, useStore as useFlowStore } from "@xyflow/react";
import {
  BoxSelect,
  Hand,
  Map as MapIcon,
  Maximize2,
  Minus,
  Plus,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import type { CanvasInteractionMode } from "./types";

export interface CanvasZoomDockProps {
  interactionMode: CanvasInteractionMode;
  onChangeMode: (mode: CanvasInteractionMode) => void;
  showMinimap: boolean;
  onToggleMinimap: () => void;
}

function DockBtn({
  label,
  shortcut,
  active,
  onClick,
  testId,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          data-testid={testId}
          className={cn(
            "flex size-8 items-center justify-center rounded-[3px] transition-colors hover:bg-muted",
            active && "bg-foreground text-background hover:bg-foreground",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {shortcut && (
          <kbd className="ml-2 font-mono text-[10px] opacity-70">{shortcut}</kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function CanvasZoomDock({
  interactionMode,
  onChangeMode,
  showMinimap,
  onToggleMinimap,
}: CanvasZoomDockProps) {
  const { t } = useTranslation();
  const rf = useReactFlow();
  const zoom = useFlowStore((s) => Math.round(s.transform[2] * 100));
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? 0 : 200;

  return (
    <div
      className="flex flex-col items-center gap-0.5 rounded-[6px] border-2 border-border bg-card p-1"
      data-testid="vs-zoom-dock"
    >
      <DockBtn
        label={t("visualSchema.dock.zoomIn")}
        onClick={() => void rf.zoomIn({ duration })}
        testId="vs-zoom-in"
      >
        <Plus className="size-4" aria-hidden />
      </DockBtn>
      <DockBtn
        label={t("visualSchema.dock.zoomOut")}
        onClick={() => void rf.zoomOut({ duration })}
        testId="vs-zoom-out"
      >
        <Minus className="size-4" aria-hidden />
      </DockBtn>
      <DockBtn
        label={t("visualSchema.dock.fitView")}
        shortcut="⇧1"
        onClick={() => void rf.fitView({ padding: 0.2, duration })}
        testId="vs-fit-view"
      >
        <Maximize2 className="size-4" aria-hidden />
      </DockBtn>

      <span className="my-0.5 h-px w-5 bg-border" aria-hidden />

      <DockBtn
        label={t("visualSchema.dock.panMode")}
        shortcut="P"
        active={interactionMode === "pan"}
        onClick={() => onChangeMode("pan")}
        testId="vs-mode-pan"
      >
        <Hand className="size-4" aria-hidden />
      </DockBtn>
      <DockBtn
        label={t("visualSchema.dock.selectMode")}
        shortcut="S"
        active={interactionMode === "select"}
        onClick={() => onChangeMode("select")}
        testId="vs-mode-select"
      >
        <BoxSelect className="size-4" aria-hidden />
      </DockBtn>

      <span className="my-0.5 h-px w-5 bg-border" aria-hidden />

      <DockBtn
        label={t("visualSchema.dock.minimap")}
        active={showMinimap}
        onClick={onToggleMinimap}
        testId="vs-toggle-minimap"
      >
        <MapIcon className="size-4" aria-hidden />
      </DockBtn>

      <button
        type="button"
        onClick={() => void rf.zoomTo(1, { duration })}
        title={t("visualSchema.dock.resetZoom")}
        className="mt-0.5 w-8 rounded-[3px] py-0.5 font-mono text-[10px] font-semibold tabular-nums text-foreground hover:bg-muted"
        data-testid="vs-zoom-percent"
      >
        {zoom}%
      </button>
    </div>
  );
}
