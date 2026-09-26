"use client";

import * as React from "react";
import type { BoardColor } from "@workspace/schemas/case-board";
import { cn } from "@workspace/ui/lib/utils";
import type { Lod } from "../lib/geometry";
import { Ports } from "./ports";

/**
 * A sticky note (PRD §5.6): text in one of the note colours. The board
 * renders its markdown (`renderText`) and swaps in an editor while it is
 * being edited; the node around it sets the size.
 */
export function NoteView({
  color,
  text,
  emptyLabel,
  placeholder,
  lod,
  readOnly,
  selected = false,
  highlight = null,
  pulse = false,
  editor = null,
  renderText,
  onDoubleClick,
}: {
  color: string;
  text: string;
  /** Read out for a note with no text. */
  emptyLabel: string;
  /** Shown in an empty note. */
  placeholder: string;
  lod: Lod;
  readOnly: boolean;
  selected?: boolean;
  highlight?: BoardColor | null;
  pulse?: boolean;
  editor?: React.ReactNode;
  renderText?: (text: string) => React.ReactNode;
  onDoubleClick?: () => void;
}) {
  return (
    <>
      <div
        className={cn(
          `cb-note-${color}`,
          "flex h-full w-full flex-col overflow-hidden rounded-[4px] border-2 p-3 text-sm text-foreground",
          selected ? "border-foreground" : "border-border/70",
          highlight && `cb-ring-${highlight}`,
          pulse && "cb-pulse",
        )}
        aria-label={text ? text.slice(0, 80) : emptyLabel}
        data-testid="note-node"
        onDoubleClick={onDoubleClick}
      >
        {editor ??
          (lod === "chip" ? (
            <p className="line-clamp-3 text-lg font-semibold">{text || emptyLabel}</p>
          ) : text ? (
            <div className="cb-markdown nowheel min-h-0 flex-1 overflow-hidden leading-snug break-words">
              {renderText ? renderText(text) : <p className="whitespace-pre-line">{text}</p>}
            </div>
          ) : (
            <p className="text-muted-foreground italic">{placeholder}</p>
          ))}
      </div>
      <Ports connectable={!readOnly} />
    </>
  );
}
