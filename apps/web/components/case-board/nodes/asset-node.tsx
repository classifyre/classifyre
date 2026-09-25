"use client";

import * as React from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { ASSET_NODE } from "../store/relations";
import type { Lod } from "../store/projection";
import type { BoardColor } from "@workspace/schemas/case-board";
import type { SeverityKey } from "../store/types";
import { AssetCircle } from "./relation-glyphs";
import { Ports } from "./ports";

export interface NodeBadge {
  text: string;
  title: string;
  /** Lime surface for "there is more to pull in", card for "there is more to show". */
  accent?: boolean;
  onClick?: () => void;
}

export interface HypothesisDot {
  id: string;
  color: string;
  title: string;
  onClick?: () => void;
}

/**
 * The shell every asset on the board shares (PRD §5.2): the old graph's
 * outlined circle with the kind icon, the name under it, corner badges and
 * hypothesis dots above. Evidence wears the lime ring; a suggested neighbour
 * does not, and offers "+" to add it instead.
 */
export function AssetNode({
  label,
  title,
  Icon,
  lod,
  inCase,
  selected,
  pulse,
  missing,
  pending,
  highlight,
  donut,
  topRight,
  bottomRight,
  topLeft,
  dots,
  action,
  readOnly,
  linkable = true,
  testId,
}: {
  label: string;
  title: string;
  Icon: LucideIcon;
  lod: Lod;
  inCase: boolean;
  selected: boolean;
  pulse?: boolean;
  missing?: boolean;
  pending?: boolean;
  highlight?: BoardColor | null;
  donut?: ReadonlyArray<{ severity: SeverityKey; count: number }> | null;
  topRight?: NodeBadge | null;
  bottomRight?: NodeBadge | null;
  topLeft?: NodeBadge | null;
  dots?: HypothesisDot[];
  action?: React.ReactNode;
  readOnly: boolean;
  /** A suggested neighbour takes no links: its ports only anchor its edges. */
  linkable?: boolean;
  testId: string;
}) {
  const { cx, cy, ring, width, height } = ASSET_NODE;
  const labelClass =
    lod === "chip"
      ? "text-[26px] font-bold line-clamp-1"
      : lod === "compact"
        ? "text-[15px] font-semibold line-clamp-2"
        : "text-[10.5px] line-clamp-2";

  return (
    <div className="relative" style={{ width, height }} title={title} data-testid={testId}>
      <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
        <AssetCircle inCase={inCase} selected={selected} pulse={pulse} missing={missing} highlight={highlight} donut={donut} />
      </svg>

      <div
        className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center text-foreground"
        style={{ left: cx, top: cy }}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />}
      </div>

      {dots && dots.length > 0 && lod !== "chip" && (
        <div className="absolute flex -translate-x-1/2 gap-[3px]" style={{ left: cx, top: cy - ring - 12 }}>
          {dots.slice(0, 6).map((dot) => (
            <button
              key={dot.id}
              type="button"
              className="nodrag nopan size-2 rounded-full ring-[1.5px] ring-background"
              style={{ background: dot.color }}
              title={dot.title}
              aria-label={dot.title}
              onClick={dot.onClick}
            />
          ))}
        </div>
      )}

      {lod !== "chip" && topRight && <Badge badge={topRight} style={{ left: cx + 14, top: cy - ring - 4 }} />}
      {lod !== "chip" && bottomRight && <Badge badge={bottomRight} style={{ left: cx + 16, top: cy + 10 }} />}
      {lod !== "chip" && topLeft && <Badge badge={topLeft} style={{ right: width - cx + 14, top: cy - ring - 4 }} />}
      {action}

      <span
        className={cn(
          "cb-halo pointer-events-none absolute inset-x-0 px-1 text-center font-mono leading-tight break-words text-foreground",
          labelClass,
          missing && "line-through decoration-[var(--cb-contradicts)]",
        )}
        style={{ top: cy + ring + 7 }}
      >
        {label}
      </span>

      <Ports connectable={!readOnly} hidden={!linkable} round={{ cx, cy, r: ring }} />
    </div>
  );
}

function Badge({ badge, style }: { badge: NodeBadge; style: React.CSSProperties }) {
  const className = cn(
    "nodrag nopan absolute rounded-[3px] border-[1.5px] px-1 font-mono text-[10px] font-bold leading-[14px] whitespace-nowrap",
    badge.accent ? "border-[#0a0a0a] bg-accent text-accent-foreground" : "border-foreground bg-card text-foreground",
    badge.onClick && "cursor-pointer hover:brightness-95",
  );
  return badge.onClick ? (
    <button type="button" className={className} style={style} title={badge.title} aria-label={badge.title} onClick={badge.onClick}>
      {badge.text}
    </button>
  ) : (
    <span className={className} style={style} title={badge.title}>
      {badge.text}
    </span>
  );
}
