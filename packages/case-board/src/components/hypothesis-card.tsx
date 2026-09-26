"use client";

import * as React from "react";
import { Check, ChevronRight, Circle, Loader2, MessageSquare, X } from "lucide-react";
import type { BoardColor } from "@workspace/schemas/case-board";
import { cn } from "@workspace/ui/lib/utils";
import { HYPOTHESIS_WIDTH, type Lod } from "../lib/geometry";
import { Ports } from "./ports";
import { StateChip, type ChipTone } from "./state-chip";

export type HypothesisStatus = "PROPOSED" | "SUPPORTED" | "REFUTED" | "INCONCLUSIVE";

export const HYPOTHESIS_STATUS_TONE: Record<HypothesisStatus, ChipTone> = {
  PROPOSED: "muted",
  SUPPORTED: "success",
  REFUTED: "destructive",
  INCONCLUSIVE: "fresh",
};

/** Words the card shows, already translated by whoever renders it. */
export interface HypothesisCardText {
  status: string;
  confidence: string;
  supports: string;
  contradicts: string;
  neutral: string;
  openThread: string;
}

/**
 * A hypothesis as a first-class card (PRD §5.5): its label and colour, the
 * statement, its verdict, how confident the team is, and the tally of
 * evidence for and against. The board edits the statement in place (pass
 * `editor`) and opens the thread from the footer.
 */
export function HypothesisCardView({
  label,
  color,
  statement,
  status,
  text,
  lod,
  readOnly,
  confidence = null,
  counts,
  entries,
  lastEntry = null,
  selected = false,
  focused = false,
  pending = false,
  busy = false,
  highlight = null,
  pulse = false,
  editor = null,
  onToggleFocus,
  onOpenThread,
}: {
  /** "H1", "H2"… */
  label: string;
  color: string;
  statement: string;
  status: HypothesisStatus;
  text: HypothesisCardText;
  lod: Lod;
  readOnly: boolean;
  /** 0–1, or null while nobody has said. */
  confidence?: number | null;
  counts: { supports: number; contradicts: number; neutral: number };
  entries: number;
  /** "Ana · 2 hours ago". */
  lastEntry?: string | null;
  selected?: boolean;
  /** Its stance edges are in focus. */
  focused?: boolean;
  /** Not saved yet. */
  pending?: boolean;
  /** Saving: a spinner in the header. */
  busy?: boolean;
  highlight?: BoardColor | null;
  pulse?: boolean;
  /** Replaces the statement while it is being edited. */
  editor?: React.ReactNode;
  /** A click on the card, not on one of its controls. */
  onToggleFocus?: () => void;
  onOpenThread?: () => void;
}) {
  const aria = `${label}: ${statement}`;
  if (lod === "chip") {
    return (
      <div
        className={cn(
          "relative flex items-center gap-2 rounded-[4px] border-2 bg-card px-3 py-3 text-base font-semibold",
          selected ? "border-foreground" : "border-border",
        )}
        style={{ width: HYPOTHESIS_WIDTH, borderLeft: `8px solid ${color}` }}
        aria-label={aria}
      >
        <span className="font-mono">{label}</span>
        <span className="min-w-0 flex-1 truncate">{statement}</span>
        <Ports connectable={!readOnly} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative rounded-[4px] border-2 bg-card text-card-foreground",
        selected || focused ? "border-foreground" : "border-border",
        pending && "opacity-70",
        highlight && `cb-ring-${highlight}`,
        pulse && "cb-pulse",
      )}
      style={{ width: HYPOTHESIS_WIDTH, borderLeftWidth: 8, borderLeftColor: color }}
      aria-label={aria}
      data-testid="hypothesis-card"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button,textarea,a")) return;
        onToggleFocus?.();
      }}
    >
      <header className="card-drag flex cursor-grab items-center gap-2 px-3 pt-2 active:cursor-grabbing">
        <span className="font-mono text-xs font-bold">{label}</span>
        <span className="flex-1" />
        {(busy || pending) && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        <StateChip tone={HYPOTHESIS_STATUS_TONE[status] ?? "muted"}>{text.status}</StateChip>
      </header>

      <div className="px-3 pt-1 pb-2">
        {editor ?? <p className="line-clamp-4 text-sm leading-snug font-medium">{statement}</p>}
      </div>

      {lod === "full" && (
        <>
          {confidence !== null && (
            <div className="flex items-center gap-2 px-3 pb-1.5 text-[11px] text-muted-foreground">
              <span>{text.confidence}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full bg-foreground" style={{ width: `${Math.round(confidence * 100)}%` }} />
              </span>
              <span className="font-mono">{confidence.toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center gap-3 border-t border-border/60 px-3 py-1.5 text-[11px]">
            <span className="inline-flex items-center gap-0.5" title={text.supports}>
              <Check className="size-3 text-[var(--cb-supports)]" aria-hidden />
              {counts.supports}
            </span>
            <span className="inline-flex items-center gap-0.5" title={text.contradicts}>
              <X className="size-3 text-[var(--cb-contradicts)]" aria-hidden />
              {counts.contradicts}
            </span>
            <span className="inline-flex items-center gap-0.5" title={text.neutral}>
              <Circle className="size-2.5 text-[var(--cb-neutral)]" aria-hidden />
              {counts.neutral}
            </span>
            <span className="flex-1" />
            <span className="inline-flex min-w-0 items-center gap-1 truncate text-muted-foreground">
              <MessageSquare className="size-3 shrink-0" aria-hidden />
              {entries}
              {lastEntry && <span className="truncate">{` · ${lastEntry}`}</span>}
            </span>
          </div>
          <div className="flex justify-end border-t border-border/60">
            <button
              type="button"
              className="nodrag inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
              disabled={pending}
              onClick={onOpenThread}
            >
              {text.openThread}
              <ChevronRight className="size-3" aria-hidden />
            </button>
          </div>
        </>
      )}
      <Ports connectable={!readOnly} />
    </div>
  );
}
