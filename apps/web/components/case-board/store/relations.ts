import { ASSET_NODE, defaultFindingSpot, FINDING_NODE, type SeverityKey, type XY } from "@workspace/case-board/lib/geometry";
import type { BoardItem, Bubble, BubbleRow } from "./types";

export {
  ASSET_NODE,
  ASSET_ROUND,
  circleAnchor,
  defaultFindingSpot,
  EVIDENCE_ROUND,
  FINDING_NODE,
  FINDING_ROUND,
  findingCode,
  PORTS,
  ringRadius,
  SOURCE_PORT,
  TARGET_PORT,
  type RoundShape,
  type XY,
} from "@workspace/case-board/lib/geometry";

/**
 * The relations view (PRD §5.2): the node-link language of the old case
 * graph, on the board. An asset is a circle with its kind icon and name. Each
 * finding in the case is its own small circle, coloured by severity and joined
 * to its asset by a CONTAINS edge. Finding nodes are React Flow children of
 * their asset node, so they travel with it, and a finding the user moved keeps
 * its spot (`item.style.findingPositions`, relative to the asset node).
 *
 * Pure, so the projection, the layout estimates and the tests share it. The
 * shapes' numbers live in @workspace/case-board, which the docs draw from too.
 */

/** An expanded asset shows this many finding nodes; the rest wait behind "▸n". */
export const MAX_FINDING_NODES = 12;

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

export const findingNodeId = (itemId: string, findingId: string) => `fd:${itemId}:${findingId}`;

export function parseFindingNodeId(id: string): { itemId: string; findingId: string } | null {
  if (!id.startsWith("fd:")) return null;
  const rest = id.slice(3);
  // Item ids are UUIDs (36 chars, no ':'); finding ids may contain anything.
  const cut = rest.indexOf(":");
  if (cut < 0) return null;
  return { itemId: rest.slice(0, cut), findingId: rest.slice(cut + 1) };
}
