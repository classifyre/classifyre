"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { BoardColor } from "@workspace/schemas/case-board";
import { cn } from "@workspace/ui/lib/utils";
import { FRAME_TITLE_HEIGHT } from "../lib/geometry";

/**
 * A named, tinted group (PRD §5.6). The board makes what is dropped inside
 * its children, so they move with it; only the title bar drags.
 */
export function FrameView({
  tint,
  title,
  untitledLabel,
  collapsed = false,
  members = null,
  toggleLabel,
  readOnly,
  selected = false,
  highlight = null,
  editor = null,
  onToggle,
  onTitleDoubleClick,
}: {
  tint: string;
  title: string;
  untitledLabel: string;
  collapsed?: boolean;
  /** "4 items", shown while collapsed. */
  members?: string | null;
  /** "Collapse" or "Expand". */
  toggleLabel: string;
  readOnly: boolean;
  selected?: boolean;
  highlight?: BoardColor | null;
  /** Replaces the title while it is being edited. */
  editor?: React.ReactNode;
  onToggle?: () => void;
  onTitleDoubleClick?: () => void;
}) {
  return (
    <div
      className={cn(
        `cb-frame-${tint}`,
        "h-full w-full rounded-[4px] border-2 border-dashed",
        selected ? "border-foreground" : "border-border/60",
        highlight && `cb-ring-${highlight}`,
      )}
      aria-label={title || untitledLabel}
      data-testid="frame-node"
    >
      <div
        className="frame-drag pointer-events-auto flex cursor-grab items-center gap-2 px-3 active:cursor-grabbing"
        style={{ height: FRAME_TITLE_HEIGHT - 4 }}
        onDoubleClick={onTitleDoubleClick}
      >
        <button
          type="button"
          className="nodrag -ml-1 rounded-[3px] p-0.5 hover:bg-muted"
          aria-label={toggleLabel}
          title={toggleLabel}
          disabled={readOnly}
          onClick={onToggle}
        >
          <ChevronDown className={cn("size-4 transition-transform", collapsed && "-rotate-90")} />
        </button>
        {editor ?? (
          <span className="min-w-0 flex-1 truncate font-serif text-sm font-black uppercase tracking-[0.03em]">
            {title || <span className="text-muted-foreground">{untitledLabel}</span>}
          </span>
        )}
        {collapsed && members && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{members}</span>}
      </div>
    </div>
  );
}
