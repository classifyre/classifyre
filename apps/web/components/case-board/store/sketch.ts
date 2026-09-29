import {
  ASSET_NODE,
  BOARD_SKETCH_LABEL_MAX_CHARS,
  BOARD_SKETCH_MAX_EDGES,
  BOARD_SKETCH_MAX_NODES,
  BOARD_SKETCH_VERSION,
  COMMENT_PIN_SIZE,
  estimateHypothesisHeight,
  FINDING_NODE,
  HYPOTHESIS_WIDTH,
  type BoardSketch,
  type BoardSketchEdgeStyle,
  type BoardSketchNode,
  type BoardSketchSeverity,
} from "@workspace/schemas/case-board";
import { HYPOTHESIS_PALETTE } from "@workspace/case-board/lib/geometry";
import { TRACE_KINDS, type TraceKind } from "@workspace/case-board/lib/kinds";
import { DEFAULT_FRAME, DEFAULT_NOTE } from "./geometry";
import {
  isFindingData,
  isItemData,
  projectEdges,
  projectNodes,
  type BoardEdge,
  type BoardNode,
  type ProjectionView,
} from "./projection";
import { hypothesisMeta } from "./selectors";
import { edgeKind } from "./trace";
import type { BoardDomain, BubbleRow, FindingVisualState } from "./types";

/**
 * The board drawn small for its case card (BoardSketch in
 * `@workspace/schemas/case-board`): the shapes the canvas shows, where the
 * canvas has them, minus its furniture. No neighbour suggestions or traces,
 * no selection or focus, every relation kind on, as anyone opening the board
 * first sees it.
 *
 * Pure, like the projection it reads, and deterministic: sizes are the
 * board's defaults and estimates, never what React Flow happened to measure,
 * so the same board always sketches the same and is not sent again because a
 * card was off screen this time.
 */

const SKETCH_VIEW: ProjectionView = {
  lod: "full",
  readOnly: true,
  neighbourHops: 0,
  hiddenSuggestions: new Set(),
  showResolvedComments: false,
  showAllRows: new Set(),
  expandedUnattached: new Set(),
  kinds: new Set(TRACE_KINDS),
};

interface Shape {
  node: BoardSketchNode;
  /** What the shape covers on the board: the sketch's box is their union. */
  box: { x: number; y: number; w: number; h: number };
  /** Lower is kept first when the board has more shapes than a sketch takes. */
  rank: number;
}

const SEVERITY_RANK: Record<BoardSketchSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const MUTED_STATES: ReadonlySet<FindingVisualState> = new Set(["deleted", "gone", "resolved", "dismissed"]);
const KIND_STYLE: Record<TraceKind, BoardSketchEdgeStyle> = { lineage: "l", links: "k", duplicates: "d", similar: "s" };
/** Links people drew and stances first, then relations, then asset → finding. */
const EDGE_RANK: Record<BoardSketchEdgeStyle, number> = {
  m: 0, q: 0, "+": 0, "-": 0, "0": 0,
  l: 1, k: 1, d: 1, s: 1,
  c: 2, g: 2,
};
const HEX = /^#[0-9a-f]{6}$/i;

export function buildBoardSketch(d: BoardDomain): BoardSketch {
  const projected = projectNodes(d, SKETCH_VIEW).filter((n) => !n.hidden);
  const edges = projectEdges(d, SKETCH_VIEW, projected);
  const meta = hypothesisMeta(d.threads);

  // Parents come first (sortParentsFirst), so a child finds its parent placed.
  const origin = new Map<string, { x: number; y: number }>();
  const shapes = new Map<string, Shape>();
  for (const n of projected) {
    const parent = n.parentId ? origin.get(n.parentId) : { x: 0, y: 0 };
    if (!parent) continue;
    const at = { x: parent.x + n.position.x, y: parent.y + n.position.y };
    origin.set(n.id, at);
    const shape = shapeOf(d, n, at, meta);
    if (shape) shapes.set(n.id, shape);
  }

  const kept = [...shapes.entries()]
    .map(([id, shape], order) => ({ id, shape, order }))
    .sort((a, b) => a.shape.rank - b.shape.rank || a.order - b.order)
    .slice(0, BOARD_SKETCH_MAX_NODES)
    .sort((a, b) => a.order - b.order);
  if (kept.length === 0) return { v: BOARD_SKETCH_VERSION, w: 0, h: 0, nodes: [], edges: [] };

  const index = new Map(kept.map(({ id }, i) => [id, i]));
  const lines = edges
    .map((e) => {
      const a = index.get(e.source);
      const b = index.get(e.target);
      const t = edgeStyle(d, e);
      return a === undefined || b === undefined || a === b || !t ? null : { a, b, t };
    })
    .filter((e): e is { a: number; b: number; t: BoardSketchEdgeStyle } => e !== null)
    .sort((x, y) => EDGE_RANK[x.t] - EDGE_RANK[y.t])
    .slice(0, BOARD_SKETCH_MAX_EDGES);

  const minX = Math.min(...kept.map(({ shape }) => shape.box.x));
  const minY = Math.min(...kept.map(({ shape }) => shape.box.y));
  const maxX = Math.max(...kept.map(({ shape }) => shape.box.x + shape.box.w));
  const maxY = Math.max(...kept.map(({ shape }) => shape.box.y + shape.box.h));
  return {
    v: BOARD_SKETCH_VERSION,
    w: Math.ceil(maxX - minX),
    h: Math.ceil(maxY - minY),
    nodes: kept.map(({ shape }) => shifted(shape.node, minX, minY)),
    edges: lines,
  };
}

function shapeOf(
  d: BoardDomain,
  n: BoardNode,
  at: { x: number; y: number },
  meta: ReturnType<typeof hypothesisMeta>,
): Shape | null {
  if (n.type === "finding" && isFindingData(n.data)) {
    const bubble = d.bubbles.get(n.data.findingOf);
    const findingId = n.data.findingId;
    const row: BubbleRow | undefined =
      bubble?.rows.find((r) => r.findingId === findingId) ?? bubble?.unattached.find((r) => r.findingId === findingId);
    const severity = row?.severity ?? "info";
    return {
      node: {
        t: "f",
        x: at.x + FINDING_NODE.cx,
        y: at.y + FINDING_NODE.cy,
        s: severity,
        ...(row && MUTED_STATES.has(row.state) ? { o: true } : {}),
        ...(n.data.attached ? {} : { g: true }),
      },
      box: { x: at.x, y: at.y, w: FINDING_NODE.width, h: FINDING_NODE.height },
      rank: 5 + SEVERITY_RANK[severity] / 10,
    };
  }
  if (!isItemData(n.data)) return null;
  const item = d.items.get(n.data.itemId);
  if (!item) return null;
  const sized = { w: n.width ?? 0, h: n.height ?? 0 };

  switch (n.type) {
    case "evidence": {
      const bubble = d.bubbles.get(item.id);
      if (!bubble) return null;
      return {
        node: {
          t: "a",
          x: at.x + ASSET_NODE.cx,
          y: at.y + ASSET_NODE.cy,
          ...(item.collapsed && bubble.maxSeverity ? { d: bubble.maxSeverity } : {}),
          ...(bubble.missing ? { m: true } : {}),
          ...(item.style.highlight ? { h: item.style.highlight } : {}),
          ...label(bubble.label),
        },
        box: { x: at.x, y: at.y, w: ASSET_NODE.width, h: ASSET_NODE.height },
        rank: 4,
      };
    }
    case "hypothesis": {
      const thread = item.refId ? d.threads.get(item.refId) : undefined;
      const w = HYPOTHESIS_WIDTH;
      const h = estimateHypothesisHeight(thread?.title);
      const color = (thread && meta.get(thread.id)?.color) || HYPOTHESIS_PALETTE[0];
      return {
        node: {
          t: "h",
          x: at.x,
          y: at.y,
          w: whole(w),
          h: whole(h),
          c: HEX.test(color) ? color : HYPOTHESIS_PALETTE[0],
          ...label(thread?.title),
          ...(thread?.resolvedAt ? { o: true } : {}),
        },
        box: { x: at.x, y: at.y, w, h },
        rank: 2,
      };
    }
    case "note": {
      const w = sized.w || DEFAULT_NOTE.width;
      const h = sized.h || DEFAULT_NOTE.height;
      return {
        node: {
          t: "n",
          x: at.x,
          y: at.y,
          w: whole(w),
          h: whole(h),
          c: item.style.color ?? "yellow",
          ...label(plainText(item.content.text)),
        },
        box: { x: at.x, y: at.y, w, h },
        rank: 1,
      };
    }
    case "frame": {
      const w = sized.w || DEFAULT_FRAME.width;
      const h = sized.h || DEFAULT_FRAME.height;
      return {
        node: {
          t: "r",
          x: at.x,
          y: at.y,
          w: whole(w),
          h: whole(h),
          c: item.style.color ?? "gray",
          ...label(item.content.title),
          ...(item.collapsed ? { k: true } : {}),
        },
        box: { x: at.x, y: at.y, w, h },
        rank: 0,
      };
    }
    case "comment":
      return {
        node: { t: "p", x: at.x + COMMENT_PIN_SIZE.width / 2, y: at.y + COMMENT_PIN_SIZE.height / 2 },
        box: { x: at.x, y: at.y, w: COMMENT_PIN_SIZE.width, h: COMMENT_PIN_SIZE.height },
        rank: 3,
      };
    default:
      return null;
  }
}

function edgeStyle(d: BoardDomain, e: BoardEdge): BoardSketchEdgeStyle | null {
  switch (e.type) {
    case "contains":
      return e.data?.ghost ? "g" : "c";
    case "system": {
      const system = e.data?.systemEdgeId ? d.systemEdges.get(e.data.systemEdgeId) : undefined;
      return system ? KIND_STYLE[edgeKind(system)] : "k";
    }
    case "link": {
      const link = e.data?.linkId ? d.links.get(e.data.linkId) : undefined;
      return link?.certainty === "SUSPECTED" ? "q" : "m";
    }
    case "stance": {
      const support = e.data?.supportId ? d.supports.get(e.data.supportId) : undefined;
      return support?.stance === "SUPPORTS" ? "+" : support?.stance === "CONTRADICTS" ? "-" : "0";
    }
    default:
      return null;
  }
}

/** The shape moved so the sketch's box starts at (0, 0), in whole units. */
function shifted(node: BoardSketchNode, dx: number, dy: number): BoardSketchNode {
  return { ...node, x: Math.max(0, Math.round(node.x - dx)), y: Math.max(0, Math.round(node.y - dy)) };
}

function whole(size: number): number {
  return Math.max(1, Math.round(size));
}

/** A label cut to what a sketch keeps, never ending in half a surrogate pair. */
function label(text: string | null | undefined): { l?: string } {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return {};
  if (clean.length <= BOARD_SKETCH_LABEL_MAX_CHARS) return { l: clean };
  let cut = clean.slice(0, BOARD_SKETCH_LABEL_MAX_CHARS - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return { l: `${cut.trimEnd()}…` };
}

/** A note's markdown as the words a reader sees. */
function plainText(markdown: string | undefined): string {
  return (markdown ?? "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, "")
    .replace(/[*_`~]+/g, "");
}

/**
 * A short content hash of a sketch (cyrb53), so the board sends one only when
 * it differs from the stored one.
 */
export function sketchSignature(sketch: BoardSketch): string {
  const text = JSON.stringify(sketch);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
