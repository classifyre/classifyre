"use client";

import * as React from "react";
import { Loader2, Plus, type LucideIcon } from "lucide-react";
import type { BoardColor } from "@workspace/schemas/case-board";
import { cn } from "@workspace/ui/lib/utils";
import { ASSET_NODE, type Lod, type SeverityKey } from "../lib/geometry";
import { EscalationFlag } from "./finding-node";
import { AssetCircle } from "./glyphs";
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
  ghost = false,
  escalated = null,
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
  /** Found by a trace beyond the board: dashed and faint. */
  ghost?: boolean;
  /**
   * Findings of this asset an escalation rule marked. Shown at every zoom —
   * at far zoom, when findings fold into the donut, it is the only sign.
   */
  escalated?: { count: number; title: string; onClick?: () => void } | null;
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
    <div className={cn("relative", ghost && "cb-ghost")} style={{ width, height }} title={title} data-testid={testId}>
      <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
        <AssetCircle inCase={inCase} selected={selected} pulse={pulse} missing={missing} highlight={highlight} donut={donut} ghost={ghost} />
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
      {escalated && escalated.count > 0 && <EscalationBadge escalated={escalated} lod={lod} />}
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

      <Ports connectable={!readOnly} hidden={!linkable} round={{ cx, cy, r: ring, top: cy - ring - 18, bottom: height + 3 }} />
    </div>
  );
}

/**
 * The escalated findings' warning flag and their count, left of the asset
 * circle, in the chrome of the node's other badges. Grows with the far-zoom
 * label so a zoomed-out board still points at them; a click spotlights every
 * escalated finding.
 */
function EscalationBadge({
  escalated,
  lod,
}: {
  escalated: { count: number; title: string; onClick?: () => void };
  lod: Lod;
}) {
  const { cx, cy, ring, width } = ASSET_NODE;
  const big = lod === "chip";
  const className = cn(
    "nodrag nopan absolute inline-flex items-center rounded-[3px] border-[1.5px] border-foreground bg-card font-mono font-bold whitespace-nowrap text-foreground",
    big ? "gap-1.5 px-2 text-[24px] leading-[34px]" : "gap-[3px] px-1 text-[10px] leading-[14px]",
    escalated.onClick && "cursor-pointer hover:brightness-95",
  );
  const style: React.CSSProperties = big
    ? { right: width - cx + ring + 6, top: cy - 18 }
    : { right: width - cx + ring + 3, top: cy - 8 };
  const content = (
    <>
      <EscalationFlag size={big ? 24 : 11} />
      {escalated.count}
    </>
  );
  return escalated.onClick ? (
    <button
      type="button"
      className={className}
      style={style}
      title={escalated.title}
      aria-label={escalated.title}
      onClick={escalated.onClick}
      data-testid="escalation-badge"
    >
      {content}
    </button>
  ) : (
    <span className={className} style={style} title={escalated.title} data-testid="escalation-badge">
      {content}
    </span>
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

/**
 * "+" on an asset that is not in the case: a suggested neighbour offers it
 * above its circle (`top`), a traced ghost beside its hop badge (`side`).
 * Either adds the asset to the case right where it stands.
 */
export function AddButton({
  placement,
  title,
  onClick,
  testId,
}: {
  placement: "top" | "side";
  title: string;
  onClick?: () => void;
  testId?: string;
}) {
  const style =
    placement === "top"
      ? { left: ASSET_NODE.cx + 12, top: ASSET_NODE.cy - ASSET_NODE.ring - 2 }
      : { left: ASSET_NODE.cx + 16, top: ASSET_NODE.cy + 8 };
  return (
    <button
      type="button"
      className="cb-add nodrag nopan absolute flex size-[18px] items-center justify-center rounded-full border-[1.5px] border-[#0a0a0a] bg-accent text-accent-foreground"
      style={style}
      onClick={onClick}
      title={title}
      aria-label={title}
      data-testid={testId}
    >
      <Plus className="size-3" strokeWidth={3} aria-hidden />
    </button>
  );
}
