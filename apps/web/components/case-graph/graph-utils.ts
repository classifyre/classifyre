import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { nodeKey, type PathResult, type SimNode } from "./graph-types";

/** Undirected adjacency over the currently visible edges. */
export function buildAdjacency(
  edges: GraphEdgeDto[],
): Map<string, Array<{ to: string; edgeId: string }>> {
  const adj = new Map<string, Array<{ to: string; edgeId: string }>>();
  const push = (from: string, to: string, edgeId: string) => {
    const arr = adj.get(from) ?? [];
    arr.push({ to, edgeId });
    adj.set(from, arr);
  };
  for (const e of edges) {
    const a = nodeKey(e.fromType, e.fromId);
    const b = nodeKey(e.toType, e.toId);
    push(a, b, e.id);
    push(b, a, e.id);
  }
  return adj;
}

/** BFS shortest path between two node keys; null when disconnected. */
export function shortestPath(
  from: string,
  to: string,
  edges: GraphEdgeDto[],
): PathResult | null {
  if (from === to) return { nodeKeys: new Set([from]), edgeIds: new Set() };
  const adj = buildAdjacency(edges);
  const prev = new Map<string, { from: string; edgeId: string }>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const { to: next, edgeId } of adj.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, { from: cur, edgeId });
      queue.push(next);
    }
  }
  if (!prev.has(to)) return null;
  const nodeKeys = new Set<string>([to]);
  const edgeIds = new Set<string>();
  let cur = to;
  while (cur !== from) {
    const step = prev.get(cur)!;
    edgeIds.add(step.edgeId);
    nodeKeys.add(step.from);
    cur = step.from;
  }
  return { nodeKeys, edgeIds };
}

/** Bounding box of laid-out nodes (world coordinates), with padding. */
export function nodesBBox(
  nodes: Iterable<SimNode>,
  pad = 60,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let any = false;
  for (const n of nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    any = true;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  if (!any) return null;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/**
 * Seed position for a node entering the simulation: next to an already-placed
 * neighbor when one exists, otherwise near the canvas center, always jittered
 * so coincident nodes do not explode the simulation.
 */
export function seedPosition(
  node: GraphNodeDto,
  edges: GraphEdgeDto[],
  placed: Map<string, SimNode>,
  center: { x: number; y: number },
): { x: number; y: number } {
  const key = nodeKey(node.type, node.id);
  const jitter = () => (Math.random() - 0.5) * 60;
  for (const e of edges) {
    const a = nodeKey(e.fromType, e.fromId);
    const b = nodeKey(e.toType, e.toId);
    const other = a === key ? b : b === key ? a : null;
    if (!other) continue;
    const neighbor = placed.get(other);
    if (neighbor && Number.isFinite(neighbor.x)) {
      return { x: neighbor.x + jitter(), y: neighbor.y + jitter() };
    }
  }
  return { x: center.x + jitter() * 4, y: center.y + jitter() * 4 };
}
