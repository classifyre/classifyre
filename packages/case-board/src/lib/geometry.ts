/**
 * The case board's visual language, in numbers (PRD §5.2): the node-link
 * drawing of the old case graph. An asset is a circle with its kind icon and
 * name; each finding is its own small circle in its severity's colour. The
 * app's board and the documentation's demos draw from these, so both look
 * the same.
 *
 * The sizes that decide what overlaps what (nodes, finding spots, cards,
 * frames) live in `@workspace/schemas/case-board`, because the API lays
 * boards out with them too (the MCP arrange tools); they are re-exported here.
 *
 * Pure: no React, so the board's store, layout estimates and tests share it.
 */

import type { NodeHandle, Position } from "@xyflow/react";
import { ASSET_NODE, FINDING_NODE, type XY } from "@workspace/schemas/case-board";

export {
  ASSET_NODE,
  defaultFindingSpot,
  FINDING_NODE,
  FRAME_TITLE_HEIGHT,
  HYPOTHESIS_WIDTH,
  ringRadius,
  type XY,
} from "@workspace/schemas/case-board";

/** Circle the edges attach to: centre relative to the node's top-left, radius. */
export interface RoundShape {
  cx: number;
  cy: number;
  r: number;
}

export type SeverityKey = "critical" | "high" | "medium" | "low" | "info";

/** Six visible states of a finding, top-down priority (the board's finding-state.ts). */
export type FindingVisualState = "deleted" | "gone" | "resolved" | "dismissed" | "new" | "open";

/** Edges end just outside the circles, clear of the rings. */
export const EVIDENCE_ROUND: RoundShape = { cx: ASSET_NODE.cx, cy: ASSET_NODE.cy, r: ASSET_NODE.ring + 3 };
export const ASSET_ROUND: RoundShape = { cx: ASSET_NODE.cx, cy: ASSET_NODE.cy, r: ASSET_NODE.r + 3 };
export const FINDING_ROUND: RoundShape = { cx: FINDING_NODE.cx, cy: FINDING_NODE.cy, r: FINDING_NODE.r + 3 };

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
export type PortId = (typeof PORTS)[keyof typeof PORTS];
/** The handles every projected edge is attached to (React Flow needs real ones). */
export const SOURCE_PORT = PORTS.right;
export const TARGET_PORT = PORTS.left;

/** How far a round node's port sits outside its circle, so it never covers the circle's edge. */
export const PORT_GAP = 9;
/** A port's box, as board.css draws it (`.board-port`). */
export const PORT_SIZE = 10;

/**
 * The circle a round node's ports sit around, in node coordinates. `top` and
 * `bottom` move those two past what sits above or below it (hypothesis dots,
 * the name), so a port never covers them.
 */
export interface RoundPorts extends RoundShape {
  top?: number;
  bottom?: number;
}

/** Centre of one of a round node's ports: the circle's compass points, just outside it. */
export function roundPortCentre(round: RoundPorts, port: PortId): XY {
  const reach = round.r + PORT_GAP;
  switch (port) {
    case PORTS.top:
      return { x: round.cx, y: round.top ?? round.cy - reach };
    case PORTS.bottom:
      return { x: round.cx, y: round.bottom ?? round.cy + reach };
    case PORTS.right:
      return { x: round.cx + reach, y: round.cy };
    case PORTS.left:
      return { x: round.cx - reach, y: round.cy };
  }
}

/** A finding node's ports: around its circle, the bottom one clear of its label. */
export const FINDING_PORTS: RoundPorts = {
  cx: FINDING_NODE.cx,
  cy: FINDING_NODE.cy,
  r: FINDING_NODE.r,
  bottom: FINDING_NODE.height + 3,
};

// React Flow's `Position` values; a type-only import keeps this module free of React.
const PORT_POSITION = { t: "top", r: "right", b: "bottom", l: "left" } as const;

/**
 * A round node's ports as React Flow handle bounds, relative to the node. A
 * node that declares these and its size counts as measured, so React Flow
 * mounts it only once it is in view, rather than mounting every new node once
 * just to measure it (every finding on a big board, each time the zoom
 * crosses into detail).
 */
export function roundPortHandles(round: RoundPorts): NodeHandle[] {
  return Object.values(PORTS).map((id) => {
    const c = roundPortCentre(round, id);
    return {
      id,
      type: "source",
      position: PORT_POSITION[id] as unknown as Position,
      x: c.x - PORT_SIZE / 2,
      y: c.y - PORT_SIZE / 2,
      width: PORT_SIZE,
      height: PORT_SIZE,
    };
  });
}

/** Level of detail from the zoom: names and labels, then shapes, then chips. */
export type Lod = "full" | "compact" | "chip";

export const lodOf = (zoom: number): Lod => (zoom >= 0.6 ? "full" : zoom >= 0.3 ? "compact" : "chip");

/** Zoom from which edge labels are legible. */
export const LABEL_ZOOM = 0.6;
