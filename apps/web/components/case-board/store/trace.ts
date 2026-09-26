import type { BoardTraceNodeDto, BoardTraceResponseDto } from "@workspace/api-client";
import type { TraceKind } from "@workspace/case-board/lib/kinds";
import { absolutePosition } from "./ops";
import { freeSpotNear, SUGGESTED_SIZE, type Rect, type XY } from "./geometry";
import { ASSET_NODE, ASSET_ROUND, SOURCE_PORT, TARGET_PORT, type RoundShape } from "./relations";
import type { BoardDomain, SystemEdge } from "./types";

/**
 * Connections beyond the case (PRD §5.11, "Show connections" and multi-hop
 * neighbours): the kinds of relation the board follows, the trace's layout
 * as ghost nodes around the asset it starts from, and the merge that turns a
 * walk from every piece of evidence into suggested neighbours.
 */

export { isDirectedKind, TRACE_KIND_STROKE, TRACE_KINDS, type TraceKind } from "@workspace/case-board/lib/kinds";
export type TraceDirection = "up" | "down" | "both";
/** Hops a trace walks; "all" is as far as the server goes. */
export type TraceDepth = 1 | 2 | 3 | 4 | 5 | "all";
export const TRACE_ALL_DEPTH = 6;
export const depthValue = (depth: TraceDepth): number => (depth === "all" ? TRACE_ALL_DEPTH : depth);

/** The kind of a relation, as the server groups them (graph-trace.ts). */
export function edgeKind(e: Pick<SystemEdge, "relationType" | "relationClass">): TraceKind {
  const rel = e.relationType.toLowerCase();
  if (e.relationClass === "IDENTITY" || rel === "likely_duplicate" || rel === "identical_content" || rel.includes("duplicate")) {
    return "duplicates";
  }
  if (rel === "related") return "similar";
  if (e.relationClass === "FLOW") return "lineage";
  return "links";
}

const CLASS_OF_KIND: Record<TraceKind, string> = {
  lineage: "FLOW",
  links: "REFERENCE",
  duplicates: "IDENTITY",
  similar: "REFERENCE",
};

/** What "Show connections" is tracing, and how far. */
export interface TraceRequest {
  /** The board node it starts from: an evidence item, or a suggested neighbour. */
  seedNodeId: string;
  seedAssetId: string;
  seedLabel: string;
  /** Where the seed stood, for a seed that is neither on the board nor suggested (a ghost re-traced). */
  seedPosition?: XY;
  direction: TraceDirection;
  depth: TraceDepth;
  kinds: TraceKind[];
  /** Most assets the walk returns: 150 unless "Show more" asked for the maximum. */
  limit?: number;
}

/** The walk's default size, and the most it will return. */
export const TRACE_LIMIT = 150;
export const TRACE_LIMIT_MAX = 300;

/** A ghost of an asset the trace reached that is not on the board. */
export type TraceNodeData = {
  traceNodeId: string;
  label: string;
  assetType: string | null;
  sourceType: string | null;
  sourceName: string | null;
  depth: number;
  side: "seed" | "up" | "down" | "side";
  viaKind: TraceKind | null;
  /** An endpoint no scan has produced: shown, never added. */
  external: boolean;
  round: RoundShape;
};

export const isTraceData = (data: unknown): data is TraceNodeData =>
  !!data && typeof (data as TraceNodeData).traceNodeId === "string";

export interface TraceNodeLike {
  id: string;
  type?: string;
  position: XY;
  parentId?: string;
}

export interface TraceEdgeLike {
  id: string;
  type: "trace";
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  deletable: false;
  reconnectable: false;
  focusable: false;
  selectable: false;
  data: { trace: { relationType: string; kind: TraceKind } };
}

export interface TraceLayout<N> {
  /** Ghost nodes to draw, for what is neither on the board nor suggested. */
  nodes: N[];
  edges: TraceEdgeLike[];
  /** Every board node that is part of the trace, the seed included. */
  keep: Set<string>;
  /** Trace node (`type:id`) → the board node that shows it. */
  nodeOf: Map<string, string>;
}

function ghostData(n: BoardTraceNodeDto): TraceNodeData {
  return {
    traceNodeId: n.id,
    label: n.label,
    assetType: n.assetType ?? null,
    sourceType: n.sourceType ?? null,
    sourceName: n.sourceName ?? null,
    depth: n.depth,
    side: n.side as TraceNodeData["side"],
    viaKind: (n.viaKind as TraceKind | null) ?? null,
    external: n.type !== "asset",
    round: ASSET_ROUND,
  };
}

const COL = 260;
const ROW = 108;
const traceKey = (type: string, id: string) => `${type}:${id}`;

/**
 * Lay a trace out around the node it starts from: upstream in columns to its
 * left, one per hop, downstream to its right, duplicates and look-alikes
 * above and below it. What is on the board already stays where it is and
 * joins the trace in place; a suggested neighbour does the same. The rest
 * become ghosts, kept clear of the board's own items.
 */
export function layoutTrace<N extends TraceNodeLike>(input: {
  result: BoardTraceResponseDto;
  seedNodeId: string;
  seedPosition?: XY;
  domain: Pick<BoardDomain, "items" | "itemByAsset">;
  projected: readonly N[];
  projectedEdgeIds: ReadonlySet<string>;
  taken: Rect[];
  makeNode: (id: string, position: XY, data: TraceNodeData) => N;
}): TraceLayout<N> {
  const { result, seedNodeId, domain, projected, projectedEdgeIds } = input;
  const projectedById = new Map(projected.map((n) => [n.id, n]));
  const nodeOf = new Map<string, string>();
  const byKey = new Map<string, BoardTraceNodeDto>();
  for (const n of result.nodes) byKey.set(traceKey(n.type, n.id), n);

  // Which board node shows each trace node.
  for (const n of result.nodes) {
    const key = traceKey(n.type, n.id);
    if (n.side === "seed") nodeOf.set(key, seedNodeId);
    else if (n.type === "asset" && domain.itemByAsset.has(n.id)) nodeOf.set(key, domain.itemByAsset.get(n.id)!);
    else if (n.type === "asset" && projectedById.has(`sg:${n.id}`)) nodeOf.set(key, `sg:${n.id}`);
    else nodeOf.set(key, `tr:${n.id}`);
  }

  // The seed's centre, which the columns are measured from.
  const seedNode = projectedById.get(seedNodeId);
  const seedAbs = domain.items.has(seedNodeId)
    ? absolutePosition(domain.items, seedNodeId)
    : (seedNode?.position ?? input.seedPosition ?? { x: 0, y: 0 });
  const cx = seedAbs.x + ASSET_NODE.cx;
  const cy = seedAbs.y + ASSET_NODE.cy;
  const nodes: N[] = [];
  // A seed that is neither on the board nor suggested (a ghost traced from)
  // keeps a ghost of its own where it stood.
  const seedTrace = result.nodes.find((n) => n.side === "seed");
  if (seedTrace && !domain.items.has(seedNodeId) && !seedNode) {
    nodes.push(input.makeNode(seedNodeId, seedAbs, ghostData(seedTrace)));
  }

  // Ghosts, grouped into columns by side and hop.
  const ghosts = result.nodes.filter((n) => nodeOf.get(traceKey(n.type, n.id))?.startsWith("tr:"));
  const columns = new Map<string, BoardTraceNodeDto[]>();
  for (const n of ghosts) {
    const col = `${n.side}|${n.depth}`;
    const list = columns.get(col);
    if (list) list.push(n);
    else columns.set(col, [n]);
  }
  // Within a column, siblings sit together, in the order of what they hang off.
  const order = new Map<string, number>();
  const sortedCols = [...columns.entries()].sort(([a], [b]) => Number(a.split("|")[1]) - Number(b.split("|")[1]));
  const taken = [...input.taken];
  for (const [col, list] of sortedCols) {
    const [side, depthText] = col.split("|") as [TraceNodeData["side"], string];
    const depth = Number(depthText);
    list.sort((a, b) => (order.get(a.via ?? "") ?? 0) - (order.get(b.via ?? "") ?? 0) || a.label.localeCompare(b.label));
    list.forEach((n, i) => {
      order.set(n.id, i);
      let centre: XY;
      if (side === "up" || side === "down") {
        centre = { x: cx + (side === "up" ? -1 : 1) * depth * COL, y: cy + (i - (list.length - 1) / 2) * ROW };
      } else {
        // Beside the seed: below it first, then above, one row further each time.
        const step = Math.floor(i / 2) + 1;
        centre = { x: cx + (depth - 1) * (COL / 2), y: cy + (i % 2 === 0 ? 1 : -1) * step * ROW * 1.2 };
      }
      const preferred = { x: centre.x - ASSET_NODE.cx, y: centre.y - ASSET_NODE.cy };
      const spot = freeSpotNear(preferred, SUGGESTED_SIZE, taken, 16, ROW / 2);
      taken.push({ x: spot.x, y: spot.y, w: SUGGESTED_SIZE.width, h: SUGGESTED_SIZE.height });
      nodes.push(input.makeNode(`tr:${n.id}`, spot, ghostData(n)));
    });
  }

  const edges: TraceEdgeLike[] = [];
  for (const e of result.edges) {
    const source = nodeOf.get(traceKey(e.fromType, e.fromId));
    const target = nodeOf.get(traceKey(e.toType, e.toId));
    if (!source || !target || source === target) continue;
    // Already on the board as a system edge: that one is the drawing.
    if (projectedEdgeIds.has(`sys:${e.id}`)) continue;
    edges.push({
      id: `tre:${e.id}`,
      type: "trace",
      source,
      sourceHandle: SOURCE_PORT,
      target,
      targetHandle: TARGET_PORT,
      deletable: false,
      reconnectable: false,
      focusable: false,
      selectable: false,
      data: { trace: { relationType: e.relationType, kind: e.kind as TraceKind } },
    });
  }

  return { nodes, edges, keep: new Set(nodeOf.values()), nodeOf };
}

/**
 * The route from a trace node back to where the trace started, nearest
 * first: what "Add the path to it" adds.
 */
export function pathToSeed(result: BoardTraceResponseDto, nodeId: string): BoardTraceNodeDto[] {
  const byId = new Map(result.nodes.map((n) => [n.id, n]));
  const out: BoardTraceNodeDto[] = [];
  const seen = new Set<string>();
  for (let n = byId.get(nodeId); n && n.side !== "seed" && !seen.has(n.id); n = n.via ? byId.get(n.via) : undefined) {
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

/**
 * Fold a walk from every piece of evidence (multi-hop neighbours) into the
 * board: its edges become system edges, and each asset it reached that is not
 * in the case becomes a suggested neighbour that knows its hop and what it
 * hangs off, so the projection can lay the hops out one beyond the other.
 */
export function mergeTraceNeighbourhood(d: BoardDomain, result: BoardTraceResponseDto): BoardDomain {
  const systemEdges = new Map(d.systemEdges);
  for (const e of result.edges) {
    if (systemEdges.has(e.id)) continue;
    systemEdges.set(e.id, {
      id: e.id,
      from: traceKey(e.fromType, e.fromId),
      to: traceKey(e.toType, e.toId),
      relationType: e.relationType,
      relationClass: e.relationClass ?? CLASS_OF_KIND[e.kind as TraceKind] ?? "REFERENCE",
      origin: "INFERRED",
      confidence: e.confidence ?? 1,
      method: null,
    });
  }
  const byId = new Map(result.nodes.map((n) => [n.id, n]));
  const suggested = new Map(d.suggested);
  // Shallowest first, so a neighbour reached two ways keeps its nearer hop.
  const reached = result.nodes
    .filter((n) => n.type === "asset" && !n.missing && n.side !== "seed" && !d.itemByAsset.has(n.id))
    .sort((a, b) => a.depth - b.depth);
  for (const n of reached) {
    const key = `sg:${n.id}`;
    const existing = suggested.get(key);
    if (existing && (existing.hop ?? 1) <= n.depth) continue;
    const via = n.via ? byId.get(n.via) : undefined;
    const viaItem = via?.type === "asset" ? d.itemByAsset.get(via.id) : undefined;
    suggested.set(key, {
      key,
      assetId: n.id,
      label: n.label,
      assetType: n.assetType ?? null,
      sourceType: n.sourceType ?? null,
      sourceName: n.sourceName ?? null,
      neighbourOf: viaItem ? [viaItem] : (existing?.neighbourOf ?? []),
      hop: n.depth,
      via: viaItem ?? (via ? `sg:${via.id}` : null),
    });
  }
  return { ...d, systemEdges, suggested };
}
