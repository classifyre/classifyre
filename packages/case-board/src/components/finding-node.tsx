"use client";

import * as React from "react";
import { Check } from "lucide-react";
import type { BoardColor } from "@workspace/schemas/case-board";
import { cn } from "@workspace/ui/lib/utils";
import { FINDING_NODE, type Lod, type SeverityKey } from "../lib/geometry";
import { codeInk, FindingCircle, type FindingLook } from "./glyphs";
import { Ports } from "./ports";

/**
 * One finding of an evidence asset, as the old case graph drew it: a small
 * circle in its severity's colour with the detector's code, the finding
 * under it. The board makes it a child of its asset's node, so it travels
 * with it; links and stances end on it.
 */
export function FindingNodeView({
  findingId,
  attached,
  severity,
  look,
  code,
  label,
  title,
  lod,
  readOnly,
  selected = false,
  highlight = null,
  newBadge = null,
  resolved = false,
  struck = false,
  faded = false,
}: {
  findingId: string;
  /** False for a finding of the asset that is not in the case: italic, a dashed ghost. */
  attached: boolean;
  severity: SeverityKey;
  look: FindingLook;
  /** The two- or three-letter code in the circle (findingCode). */
  code: string;
  /** "Type: value" under the circle, at full detail. */
  label: string;
  title: string;
  lod: Lod;
  readOnly: boolean;
  selected?: boolean;
  highlight?: BoardColor | null;
  /** Text of the NEW badge, when the finding is new to the case. */
  newBadge?: string | null;
  /** Resolved findings wear a green check. */
  resolved?: boolean;
  /** Dismissed findings have their label struck through. */
  struck?: boolean;
  /** Settled findings the View menu asked to fade (never hide). */
  faded?: boolean;
}) {
  const { cx, cy, r, width, height } = FINDING_NODE;
  return (
    <div
      className={cn("relative", faded && "opacity-25")}
      style={{ width, height }}
      title={title}
      data-finding-id={findingId}
      data-row-attached={attached ? "true" : "false"}
      data-testid="finding-node"
    >
      <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
        <FindingCircle severity={severity} look={look} selected={selected} highlight={highlight} />
      </svg>
      <span
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[9.5px] font-bold leading-none"
        style={{ left: cx, top: cy + 0.5, color: codeInk(severity, look) }}
      >
        {code}
      </span>
      {newBadge && (
        <span
          className="pointer-events-none absolute rounded-[2px] border border-[#0a0a0a] bg-accent px-[3px] font-mono text-[7.5px] font-bold leading-[10px] text-accent-foreground"
          style={{ left: cx + 7, top: cy - r - 7 }}
        >
          {newBadge}
        </span>
      )}
      {resolved && (
        <span
          className="pointer-events-none absolute flex size-3 items-center justify-center rounded-full bg-[var(--cb-supports)] text-white"
          style={{ left: cx + 6, top: cy + 5 }}
        >
          <Check className="size-2" strokeWidth={3.5} aria-hidden />
        </span>
      )}
      {lod === "full" && (
        <span
          className={cn(
            "cb-halo pointer-events-none absolute inset-x-0 truncate px-0.5 text-center font-mono text-[9.5px] leading-tight text-muted-foreground",
            struck && "line-through",
            !attached && "italic",
          )}
          style={{ top: cy + r + 5 }}
        >
          {label}
        </span>
      )}
      <Ports connectable={!readOnly} round={{ cx, cy, r, bottom: FINDING_NODE.height + 3 }} core={{ cx, cy, d: 2 * r + 8 }} />
    </div>
  );
}
