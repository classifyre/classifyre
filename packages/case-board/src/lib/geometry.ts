/**
 * The case board's visual language, in numbers (PRD §5.2): the node-link
 * drawing of the old case graph. An asset is a circle with its kind icon and
 * name; each finding is its own small circle in its severity's colour. The
 * app's board and the documentation's demos draw from these, so both look
 * the same.
 *
 * Pure: no React, so the board's store, layout estimates and tests share it.
 */

export interface XY {
  x: number;
  y: number;
}

/** Circle the edges attach to: centre relative to the node's top-left, radius. */
export interface RoundShape {
  cx: number;
  cy: number;
  r: number;
}

export type SeverityKey = "critical" | "high" | "medium" | "low" | "info";

/** Six visible states of a finding, top-down priority (the board's finding-state.ts). */
export type FindingVisualState = "deleted" | "gone" | "resolved" | "dismissed" | "new" | "open";

export const ASSET_NODE = {
  width: 176,
  /** Asset circle centre, leaving room above for hypothesis dots and badges. */
  cx: 88,
  cy: 30,
  r: 19,
  /** The lime "in the case" ring. */
  ring: 24,
  height: 92,
} as const;

export const FINDING_NODE = {
  width: 132,
  cx: 66,
  cy: 17,
  r: 13,
  height: 50,
} as const;

/** Edges end just outside the circles, clear of the rings. */
export const EVIDENCE_ROUND: RoundShape = { cx: ASSET_NODE.cx, cy: ASSET_NODE.cy, r: ASSET_NODE.ring + 3 };
export const ASSET_ROUND: RoundShape = { cx: ASSET_NODE.cx, cy: ASSET_NODE.cy, r: ASSET_NODE.r + 3 };
export const FINDING_ROUND: RoundShape = { cx: FINDING_NODE.cx, cy: FINDING_NODE.cy, r: FINDING_NODE.r + 3 };

/** Radius of the ring the default finding spots sit on: wide enough that labels don't collide. */
export function ringRadius(count: number): number {
  return Math.max(118, Math.round((count * 96) / (2 * Math.PI)));
}

/**
 * Default spot of finding `index` of `count`, as the finding node's top-left
 * relative to the asset node's top-left. A few findings fan out to the right
 * of their asset; four or more go all the way round, starting at 12 o'clock.
 */
export function defaultFindingSpot(index: number, count: number): XY {
  const r = ringRadius(count);
  let angle: number;
  if (count <= 3) {
    const spread = count === 1 ? 0 : count === 2 ? Math.PI / 7 : Math.PI / 4.5;
    angle = count === 1 ? 0 : -spread + (2 * spread * index) / (count - 1);
  } else {
    angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
  }
  return {
    x: Math.round(ASSET_NODE.cx + r * Math.cos(angle) - FINDING_NODE.cx),
    y: Math.round(ASSET_NODE.cy + r * Math.sin(angle) - FINDING_NODE.cy),
  };
}

/**
 * Hypothesis colours when a thread has none of its own. The same eight hues
 * the legacy graph used, so a hypothesis keeps its colour across the switch.
 */
export const HYPOTHESIS_PALETTE = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
] as const;

/** Hypothesis cards are this wide; their height follows the statement. */
export const HYPOTHESIS_WIDTH = 300;

/** A frame's title bar; its contents start below it. */
export const FRAME_TITLE_HEIGHT = 40;

/** Where the line from a circle's centre towards `towards` leaves the circle. */
export function circleAnchor(
  cx: number,
  cy: number,
  r: number,
  towards: XY,
): XY & { nx: number; ny: number } {
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  const len = Math.hypot(dx, dy);
  const nx = len > 0 ? dx / len : 1;
  const ny = len > 0 ? dy / len : 0;
  return { x: cx + nx * r, y: cy + ny * r, nx, ny };
}

/**
 * The two- or three-letter code inside a finding node, as the old graph drew
 * it: a custom detector's initials ("Austrian company ID" → "ACI"), or the
 * first letters of a one-word detector type.
 */
export function findingCode(detector: string | null, fallback: string): string {
  const name = (detector ?? "").trim() || fallback.trim();
  const words = name.split(/[\s_\-:./]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const word = words[0]!;
    return (word.length <= 4 ? word : word.slice(0, 3)).toUpperCase();
  }
  return words
    .map((w) => w[0]!)
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

/**
 * Every linkable node has four ports, one per side, each both a place to pull
 * a link from and to drop one (ConnectionMode.Loose). Ports are only where a
 * drag starts and lands: edges float to the nearest side of each node, and a
 * link stores no port.
 */
export const PORTS = { top: "t", right: "r", bottom: "b", left: "l" } as const;
/** The handles every projected edge is attached to (React Flow needs real ones). */
export const SOURCE_PORT = PORTS.right;
export const TARGET_PORT = PORTS.left;

/** Level of detail from the zoom: names and labels, then shapes, then chips. */
export type Lod = "full" | "compact" | "chip";

export const lodOf = (zoom: number): Lod => (zoom >= 0.6 ? "full" : zoom >= 0.3 ? "compact" : "chip");

/** Zoom from which edge labels are legible. */
export const LABEL_ZOOM = 0.6;
