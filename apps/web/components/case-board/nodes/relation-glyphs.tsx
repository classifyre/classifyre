"use client";

import * as React from "react";
import { FINDING_SEVERITY_COLOR_BY_LEVEL } from "@workspace/ui/lib/finding-severity";
import type { BoardColor } from "@workspace/schemas/case-board";
import { ASSET_NODE, FINDING_NODE } from "../store/relations";
import type { FindingVisualState, SeverityKey } from "../store/types";

/** The severity palette the old graph canvas used. */
export const SEVERITY_COLOR: Record<SeverityKey, string> = FINDING_SEVERITY_COLOR_BY_LEVEL;

/** Ink for the code inside a filled finding circle: amber is too light for white. */
export const CODE_INK: Record<SeverityKey, string> = {
  critical: "#ffffff",
  high: "#ffffff",
  medium: "#1c1917",
  low: "#ffffff",
  info: "#ffffff",
};

/** A finding circle's look: its state, or `ghost` for one not in the case. */
export type FindingLook = FindingVisualState | "ghost";

/** Stroke arcs around a circle, one per severity, sized by share, from 12 o'clock. */
function DonutArcs({
  cx,
  cy,
  r,
  mix,
}: {
  cx: number;
  cy: number;
  r: number;
  mix: ReadonlyArray<{ severity: SeverityKey; count: number }>;
}) {
  const total = mix.reduce((sum, m) => sum + m.count, 0);
  if (total === 0) return null;
  if (mix.length === 1) {
    return <circle cx={cx} cy={cy} r={r} fill="none" stroke={SEVERITY_COLOR[mix[0]!.severity]} strokeWidth={3.5} />;
  }
  const gap = 0.07;
  let start = -Math.PI / 2;
  return (
    <>
      {mix.map((m) => {
        const sweep = (m.count / total) * Math.PI * 2;
        const a0 = start + gap / 2;
        const a1 = start + sweep - gap / 2;
        start += sweep;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p0 = { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) };
        const p1 = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) };
        return (
          <path
            key={m.severity}
            d={`M${p0.x},${p0.y} A${r},${r} 0 ${large} 1 ${p1.x},${p1.y}`}
            fill="none"
            stroke={SEVERITY_COLOR[m.severity]}
            strokeWidth={3.5}
          />
        );
      })}
    </>
  );
}

/**
 * An asset as the old graph drew it: an outlined circle (the icon goes on top
 * in HTML), a lime ring when it is in the case, a severity donut while its
 * findings are folded away.
 */
export function AssetCircle({
  cx = ASSET_NODE.cx,
  cy = ASSET_NODE.cy,
  inCase,
  selected = false,
  pulse = false,
  missing = false,
  highlight = null,
  donut = null,
}: {
  cx?: number;
  cy?: number;
  inCase: boolean;
  selected?: boolean;
  pulse?: boolean;
  missing?: boolean;
  highlight?: BoardColor | null;
  donut?: ReadonlyArray<{ severity: SeverityKey; count: number }> | null;
}) {
  const ring = ASSET_NODE.ring;
  return (
    <g>
      {highlight && (
        <circle cx={cx} cy={cy} r={ring + 7} fill="none" stroke={`var(--cb-${highlight})`} strokeWidth={5} opacity={0.8} />
      )}
      {selected && <circle className="cb-glow" cx={cx} cy={cy} r={ring + 4} fill="none" stroke="var(--cb-select)" strokeWidth={3} />}
      {pulse && <circle className="cb-pulse-ring" cx={cx} cy={cy} r={ring + 4} fill="none" stroke="var(--cb-select)" />}
      {inCase && <circle cx={cx} cy={cy} r={ring} fill="none" stroke="var(--cb-evidence)" strokeWidth={2.5} />}
      {/* A wider transparent disc: the whole circle is the place to grab. */}
      <circle cx={cx} cy={cy} r={ASSET_NODE.r + 3} fill="var(--background)" opacity={0.01} />
      {donut && <DonutArcs cx={cx} cy={cy} r={ASSET_NODE.r + 2.25} mix={donut} />}
      <circle
        cx={cx}
        cy={cy}
        r={ASSET_NODE.r - 2}
        fill="var(--background)"
        stroke={missing ? "var(--cb-contradicts)" : "var(--foreground)"}
        strokeWidth={1.75}
        strokeDasharray={missing ? "3 2" : undefined}
      />
    </g>
  );
}

/**
 * A finding as the old graph drew it: a small circle filled with its
 * severity's colour. Settled findings go hollow (resolved keeps its colour,
 * dismissed and deleted turn grey and dashed); one gone from its source gets
 * the dashed red ring; one not in the case is a dashed grey ghost.
 */
export function FindingCircle({
  cx = FINDING_NODE.cx,
  cy = FINDING_NODE.cy,
  severity,
  look,
  selected = false,
  highlight = null,
}: {
  cx?: number;
  cy?: number;
  severity: SeverityKey;
  look: FindingLook;
  selected?: boolean;
  highlight?: BoardColor | null;
}) {
  const r = FINDING_NODE.r;
  const color = SEVERITY_COLOR[severity];
  const hollow = look === "resolved" || look === "dismissed" || look === "deleted" || look === "ghost";
  const stroke =
    look === "resolved" ? color : hollow ? "var(--muted-foreground)" : "var(--foreground)";
  const dash =
    look === "dismissed" ? "3 2" : look === "deleted" ? "1 2" : look === "ghost" ? "2.5 2" : undefined;
  return (
    <g opacity={look === "deleted" ? 0.5 : look === "gone" ? 0.75 : 1}>
      {highlight && (
        <circle cx={cx} cy={cy} r={r + 6} fill="none" stroke={`var(--cb-${highlight})`} strokeWidth={4} opacity={0.8} />
      )}
      {selected && <circle className="cb-glow" cx={cx} cy={cy} r={r + 4} fill="none" stroke="var(--cb-select)" strokeWidth={2.5} />}
      {look === "gone" && (
        <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="var(--cb-contradicts)" strokeWidth={2} strokeDasharray="4 3" />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={hollow ? "var(--background)" : color}
        stroke={stroke}
        strokeWidth={look === "resolved" ? 2.5 : hollow ? 1.5 : 2}
        strokeDasharray={dash}
      />
    </g>
  );
}

/** Text colour of a finding's code for a given look. */
export function codeInk(severity: SeverityKey, look: FindingLook): string {
  if (look === "resolved") return SEVERITY_COLOR[severity];
  if (look === "dismissed" || look === "deleted" || look === "ghost") return "var(--muted-foreground)";
  return CODE_INK[severity];
}
