"use client";

import * as React from "react";
import { useReactFlow, useStore as useFlowStore } from "@xyflow/react";
import { Map as MapIcon, Maximize2, Minus, Plus, ScanSearch } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useUi, useUiStore } from "../store/board-context";

function ZoomButton({
  label,
  onClick,
  active,
  wide,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  /** Only shown when the board is wide enough for the whole control row. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "size-8 items-center justify-center rounded-[3px] hover:bg-muted",
        wide ? "hidden @5xl/board:flex" : "flex",
        active && "bg-foreground text-background hover:bg-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Bottom-right: zoom out / percentage / in, fit, zoom to selection, mini-map. */
export function ZoomControls() {
  const { t } = useTranslation();
  const rf = useReactFlow();
  const zoom = useFlowStore((s) => Math.round(s.transform[2] * 100));
  const minimap = useUi((s) => s.view.minimap);
  const ui = useUiStore();
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? 0 : 200;

  return (
    <div className="flex items-center gap-0.5 rounded-[6px] border-2 border-border bg-card p-1" data-testid="zoom-controls">
      <ZoomButton wide label={t("caseBoard.zoom.out")} onClick={() => void rf.zoomOut({ duration })}>
        <Minus className="size-4" aria-hidden />
      </ZoomButton>
      <button
        type="button"
        className="w-12 font-mono text-xs tabular-nums hover:underline"
        title={t("caseBoard.zoom.fit")}
        onClick={() => void rf.zoomTo(1, { duration })}
      >
        {zoom}%
      </button>
      <ZoomButton wide label={t("caseBoard.zoom.in")} onClick={() => void rf.zoomIn({ duration })}>
        <Plus className="size-4" aria-hidden />
      </ZoomButton>
      <span className="mx-0.5 hidden h-5 w-px bg-border @5xl/board:block" aria-hidden />
      <ZoomButton label={`${t("caseBoard.zoom.fit")} (⇧1)`} onClick={() => void rf.fitView({ duration, padding: 0.15 })}>
        <Maximize2 className="size-4" aria-hidden />
      </ZoomButton>
      <ZoomButton
        wide
        label={`${t("caseBoard.zoom.selection")} (⇧2)`}
        onClick={() => {
          const nodes = rf.getNodes().filter((n) => n.selected);
          if (nodes.length > 0) void rf.fitView({ nodes, duration, padding: 0.3, maxZoom: 1.2 });
        }}
      >
        <ScanSearch className="size-4" aria-hidden />
      </ZoomButton>
      <ZoomButton
        wide
        label={t("caseBoard.zoom.minimap")}
        active={minimap}
        onClick={() => ui.getState().setView({ minimap: !minimap })}
      >
        <MapIcon className="size-4" aria-hidden />
      </ZoomButton>
    </div>
  );
}
