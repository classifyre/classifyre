import type { BoardItem, Bubble, BubbleRow, SeverityKey } from "./types";

/**
 * The relations view (PRD §5.2): the node-link language of the old case
 * graph, on the board. An asset is a circle with its kind icon and name. Each
 * finding in the case is its own small circle, coloured by severity and joined
 * to its asset by a CONTAINS edge. Finding nodes are React Flow children of
 * their asset node, so they travel with it, and a finding the user moved keeps
 * its spot (`item.style.findingPositions`, relative to the asset node).
 *
 * Pure, so the projection, the layout estimates and the tests share it.
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

/** An expanded asset shows this many finding nodes; the rest wait behind "▸n". */
export const MAX_FINDING_NODES = 12;

/** Edges end just outside the circles, clear of the rings. */
export const EVIDENCE_ROUND: RoundShape = { cx: ASSET_NODE.cx, cy: ASSET_NODE.cy, r: ASSET_NODE.ring + 3 };
export const ASSET_ROUND: RoundShape = { cx: ASSET_NODE.cx, cy: ASSET_NODE.cy, r: ASSET_NODE.r + 3 };
export const FINDING_ROUND: RoundShape = { cx: FINDING_NODE.cx, cy: FINDING_NODE.cy, r: FINDING_NODE.r + 3 };

export interface ShownFinding {
  row: BubbleRow;
  /** False for a finding of the asset that is not in the case ("+n", shown on demand). */
  attached: boolean;
}

export interface ShownFindings {
  nodes: ShownFinding[];
  /** Attached findings past MAX_FINDING_NODES, behind the "▸n" badge. */
  folded: number;
}

export function shownFindings(
  bubble: Pick<Bubble, "rows" | "unattached">,
  opts: { showAll: boolean; showUnattached: boolean },
): ShownFindings {
  const attached = opts.showAll ? bubble.rows : bubble.rows.slice(0, MAX_FINDING_NODES);
  const nodes: ShownFinding[] = attached.map((row) => ({ row, attached: true }));
  if (opts.showUnattached) for (const row of bubble.unattached) nodes.push({ row, attached: false });
  return { nodes, folded: bubble.rows.length - attached.length };
}

/** Radius of the ring the default spots sit on: wide enough that labels don't collide. */
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

/** Where a finding node sits: the spot the user gave it, or its default one. */
export function findingSpot(item: Pick<BoardItem, "style">, findingId: string, index: number, count: number): XY {
  return item.style.findingPositions?.[findingId] ?? defaultFindingSpot(index, count);
}

/** Space an item takes around its position: its own box, or an asset with its findings. */
export interface Extent {
  dx: number;
  dy: number;
  width: number;
  height: number;
}

export function evidenceExtent(
  item: Pick<BoardItem, "style" | "collapsed">,
  bubble: Pick<Bubble, "rows" | "unattached"> | undefined,
  opts: { showAll: boolean; showUnattached: boolean } = { showAll: false, showUnattached: false },
): Extent {
  let x0 = 0;
  let y0 = 0;
  let x1: number = ASSET_NODE.width;
  let y1: number = ASSET_NODE.height;
  if (bubble && !item.collapsed) {
    const { nodes } = shownFindings(bubble, opts);
    nodes.forEach(({ row }, i) => {
      const spot = findingSpot(item, row.findingId, i, nodes.length);
      x0 = Math.min(x0, spot.x);
      y0 = Math.min(y0, spot.y);
      x1 = Math.max(x1, spot.x + FINDING_NODE.width);
      y1 = Math.max(y1, spot.y + FINDING_NODE.height);
    });
  }
  return { dx: x0, dy: y0, width: x1 - x0, height: y1 - y0 };
}

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

/** Findings per severity, for the donut a collapsed asset wears. */
export function severityMix(rows: readonly Pick<BubbleRow, "severity">[]): Array<{ severity: SeverityKey; count: number }> {
  const order: SeverityKey[] = ["critical", "high", "medium", "low", "info"];
  const counts = new Map<SeverityKey, number>();
  for (const row of rows) {
    const key = row.severity ?? "info";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return order.filter((k) => counts.has(k)).map((severity) => ({ severity, count: counts.get(severity)! }));
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

export const findingNodeId = (itemId: string, findingId: string) => `fd:${itemId}:${findingId}`;

export function parseFindingNodeId(id: string): { itemId: string; findingId: string } | null {
  if (!id.startsWith("fd:")) return null;
  const rest = id.slice(3);
  // Item ids are UUIDs (36 chars, no ':'); finding ids may contain anything.
  const cut = rest.indexOf(":");
  if (cut < 0) return null;
  return { itemId: rest.slice(0, cut), findingId: rest.slice(cut + 1) };
}
