import type { Edge, Node } from "@xyflow/react";
import { bendParallel } from "@workspace/case-board/lib/edges";
import type { Lod } from "@workspace/case-board/lib/geometry";
import { absolutePosition } from "./ops";
import {
  ASSET_ROUND,
  EVIDENCE_ROUND,
  FINDING_ROUND,
  findingNodeId,
  findingSpot,
  parseFindingNodeId,
  shownFindings,
  SOURCE_PORT,
  TARGET_PORT,
  type RoundShape,
  type ShownFinding,
} from "./relations";
import { edgeKind, type TraceKind, type TraceNodeData } from "./trace";
import {
  DEFAULT_FRAME,
  DEFAULT_NOTE,
  FRAME_TITLE_HEIGHT,
  freeSpotNear,
  itemExtent,
  SUGGESTED_SIZE,
  takenRects,
} from "./geometry";
import type { BoardDomain, BoardItem, Bubble, SystemEdge } from "./types";

/**
 * Store → React Flow (PRD §8.5). Pure, so it is unit-tested without a canvas.
 *
 * Node data is tiny — `{ itemId }` — and components read the record from the
 * store. Evidence is an asset node plus one child node per finding (the
 * relations view, see relations.ts). Every endpoint resolves to a node that
 * exists *right now*: a finding's own node while it is shown, otherwise its
 * asset (collapsed assets, far-zoom chips, findings folded into "▸n").
 */


export { bendParallel } from "@workspace/case-board/lib/edges";
export { lodOf, type Lod } from "@workspace/case-board/lib/geometry";
export { HYPOTHESIS_WIDTH, DEFAULT_NOTE, DEFAULT_FRAME } from "./geometry";
export { MAX_FINDING_NODES } from "./relations";
export { FRAME_TITLE_HEIGHT } from "./geometry";

export type BoardNodeType =
  | "evidence"
  | "finding"
  | "hypothesis"
  | "note"
  | "frame"
  | "comment"
  | "suggested"
  | "trace";

/** Round nodes (assets) carry the circle their edges attach to. */
export type ItemNodeData = { itemId: string; round?: RoundShape };
/** A finding shown as its own node, a child of its asset's node. */
export type FindingNodeData = { findingOf: string; findingId: string; attached: boolean; round: RoundShape };
export type SuggestedNodeData = { suggestedKey: string; round: RoundShape };
export type BoardNode = Node<ItemNodeData | FindingNodeData | SuggestedNodeData | TraceNodeData, BoardNodeType>;

export type BoardEdgeType = "system" | "link" | "stance" | "suggested" | "contains" | "trace";
export interface BoardEdgeData extends Record<string, unknown> {
  systemEdgeId?: string;
  linkId?: string;
  supportId?: string;
  /** Parallel system edges folded into this one. */
  count?: number;
  /** Contains edge to a finding that is not in the case. */
  ghost?: boolean;
  /** Parallel edges between one pair bow apart: 0 straight, ±1, ±2… */
  bend?: number;
  /** A relation "Show connections" found beyond the board. */
  trace?: { relationType: string; kind: TraceKind };
}
export type BoardEdge = Edge<BoardEdgeData, BoardEdgeType>;

export interface ProjectionView {
  lod: Lod;
  readOnly: boolean;
  /** Suggested neighbours drawn up to this many hops from the evidence; 0 draws none. */
  neighbourHops: number;
  hiddenSuggestions: ReadonlySet<string>;
  showResolvedComments: boolean;
  showAllRows: ReadonlySet<string>;
  expandedUnattached: ReadonlySet<string>;
  /** Kinds of relation drawn (and followed to neighbours). */
  kinds: ReadonlySet<TraceKind>;
}

export const isItemData = (data: unknown): data is ItemNodeData =>
  !!data && typeof (data as ItemNodeData).itemId === "string";

export const isFindingData = (data: unknown): data is FindingNodeData =>
  !!data && typeof (data as FindingNodeData).findingOf === "string";

type FindingView = Pick<ProjectionView, "lod" | "showAllRows" | "expandedUnattached">;

/**
 * The findings of an asset drawn as their own nodes. None for a collapsed
 * asset (it wears a severity donut instead) or at far zoom, where the board
 * is assets only.
 */
export function findingNodesOf(bubble: Bubble, item: BoardItem, view: FindingView): ShownFinding[] {
  if (view.lod === "chip" || item.collapsed) return [];
  return shownFindings(bubble, {
    showAll: view.showAllRows.has(item.id),
    showUnattached: view.expandedUnattached.has(item.id),
  }).nodes;
}

/** Ids of the findings of an asset that have a node on screen. */
export function visibleRowIds(bubble: Bubble, item: BoardItem, view: FindingView): Set<string> {
  return new Set(findingNodesOf(bubble, item, view).map((f) => f.row.findingId));
}

/** The class an edge is filtered and drawn by (REFERENCE covers USAGE). */
export function edgeDrawClass(e: Pick<SystemEdge, "relationClass" | "relationType">): string {
  const rel = e.relationType.toLowerCase();
  if (e.relationClass === "IDENTITY" || rel.includes("duplicate") || rel === "identical_content") {
    return "IDENTITY";
  }
  if (e.relationClass === "FLOW") return "FLOW";
  return "REFERENCE";
}

function itemPlaced(item: BoardItem | undefined): item is BoardItem {
  return !!item && item.x !== null && item.y !== null;
}

/** Parent must be placed, present, and not the item itself. */
function effectiveParent(d: BoardDomain, item: BoardItem): BoardItem | null {
  if (!item.parentId || item.parentId === item.id) return null;
  const parent = d.items.get(item.parentId);
  return itemPlaced(parent) ? parent : null;
}

/** An item inside a collapsed frame is hidden, as is anything under it. */
function hiddenByFrame(d: BoardDomain, item: BoardItem): boolean {
  let cursor = effectiveParent(d, item);
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (cursor.kind === "FRAME" && cursor.collapsed) return true;
    cursor = effectiveParent(d, cursor);
  }
  return false;
}

export function projectNodes(d: BoardDomain, view: ProjectionView): BoardNode[] {
  const nodes: BoardNode[] = [];
  for (const item of d.items.values()) {
    if (!itemPlaced(item)) continue;
    if (item.kind === "COMMENT" && item.refId) {
      const thread = d.threads.get(item.refId);
      if (thread?.resolvedAt && !view.showResolvedComments) continue;
    }
    if (item.kind === "EVIDENCE" && !d.bubbles.has(item.id)) continue;
    const parent = effectiveParent(d, item);
    const type = item.kind.toLowerCase() as BoardNodeType;
    const sized = item.kind === "NOTE" || item.kind === "FRAME";
    const defaults = item.kind === "FRAME" ? DEFAULT_FRAME : DEFAULT_NOTE;
    const bubble = item.kind === "EVIDENCE" ? d.bubbles.get(item.id) : undefined;
    const hidden = hiddenByFrame(d, item);
    nodes.push({
      id: item.id,
      type,
      position: { x: item.x!, y: item.y! },
      data: bubble ? { itemId: item.id, round: EVIDENCE_ROUND } : { itemId: item.id },
      ...(parent ? { parentId: parent.id } : {}),
      zIndex: item.kind === "FRAME" ? -1 : item.kind === "COMMENT" ? 1000 + item.z : item.z,
      ...(sized
        ? {
            width: item.width ?? defaults.width,
            height:
              item.kind === "FRAME" && item.collapsed
                ? FRAME_TITLE_HEIGHT
                : (item.height ?? defaults.height),
          }
        : {}),
      ...(item.kind === "HYPOTHESIS" ? { dragHandle: ".card-drag" } : {}),
      deletable: false,
      draggable: !view.readOnly,
      connectable: !view.readOnly && item.kind !== "FRAME" && item.kind !== "COMMENT",
      hidden,
    });

    // Each shown finding is its own node, a child of the asset: it travels
    // with it, and keeps the spot the user dragged it to.
    if (bubble) {
      const findings = findingNodesOf(bubble, item, view);
      findings.forEach(({ row, attached }, index) => {
        nodes.push({
          id: findingNodeId(item.id, row.findingId),
          type: "finding",
          position: findingSpot(item, row.findingId, index, findings.length),
          parentId: item.id,
          data: { findingOf: item.id, findingId: row.findingId, attached, round: FINDING_ROUND },
          zIndex: item.z,
          deletable: false,
          draggable: !view.readOnly,
          connectable: !view.readOnly,
          hidden,
        });
      });
    }
  }

  if (view.neighbourHops > 0 && d.suggested.size > 0) {
    // Ghosts go into free space beside what they hang off — the bubble for
    // the first hop, the ghost before for the next — never on top of the
    // board's own items: estimated sizes, since ghosts are laid out before
    // React Flow has measured anything.
    const taken = takenRects(d, (item) => hiddenByFrame(d, item));
    const kindsOf = suggestionKinds(d);
    const placed = new Map<string, { x: number; y: number }>();
    const ordered = [...d.suggested.values()].sort((a, b) => (a.hop ?? 1) - (b.hop ?? 1));
    for (const s of ordered) {
      if (view.hiddenSuggestions.has(s.key) || (s.hop ?? 1) > view.neighbourHops) continue;
      const kinds = kindsOf.get(`asset:${s.assetId}`);
      if (kinds && ![...kinds].some((k) => view.kinds.has(k))) continue;
      let from: { x: number; y: number; right: number } | null = null;
      const anchorId = s.neighbourOf.find((id) => itemPlaced(d.items.get(id)));
      if (anchorId) {
        const anchor = d.items.get(anchorId)!;
        const abs = absolutePosition(d.items, anchorId);
        const ext = itemExtent(d, anchor);
        from = { x: abs.x, y: abs.y, right: abs.x + ext.dx + ext.width };
      } else if (s.via && placed.has(s.via)) {
        const p = placed.get(s.via)!;
        from = { x: p.x, y: p.y, right: p.x + SUGGESTED_SIZE.width };
      }
      if (!from) continue;
      const spot = freeSpotNear(
        { x: from.right + 40, y: from.y },
        SUGGESTED_SIZE,
        taken,
        24,
        SUGGESTED_SIZE.height / 2,
      );
      taken.push({ x: spot.x, y: spot.y, w: SUGGESTED_SIZE.width, h: SUGGESTED_SIZE.height });
      placed.set(s.key, spot);
      nodes.push({
        id: s.key,
        type: "suggested",
        position: spot,
        data: { suggestedKey: s.key, round: ASSET_ROUND },
        zIndex: -0.5,
        deletable: false,
        draggable: false,
        connectable: false,
        selectable: true,
      });
    }
  }
  return sortParentsFirst(nodes);
}

/** The kinds of relation that tie each suggested asset (`asset:<id>`) to the board. */
function suggestionKinds(d: BoardDomain): Map<string, Set<TraceKind>> {
  const out = new Map<string, Set<TraceKind>>();
  for (const e of d.systemEdges.values()) {
    const kind = edgeKind(e);
    for (const key of [e.from, e.to]) {
      if (!key.startsWith("asset:") || d.itemByAsset.has(key.slice(6))) continue;
      const set = out.get(key);
      if (set) set.add(kind);
      else out.set(key, new Set([kind]));
    }
  }
  return out;
}

/** React Flow requires every parent to come before its children. */
export function sortParentsFirst(nodes: BoardNode[]): BoardNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const depthOf = (n: BoardNode, seen = new Set<string>()): number => {
    const cached = depth.get(n.id);
    if (cached !== undefined) return cached;
    if (!n.parentId || seen.has(n.id)) return 0;
    seen.add(n.id);
    const parent = byId.get(n.parentId);
    const value = parent ? depthOf(parent, seen) + 1 : 0;
    depth.set(n.id, value);
    return value;
  };
  return nodes
    .map((n, i) => ({ n, i, d: depthOf(n) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.n);
}

interface ResolvedEnd {
  nodeId: string;
}

/**
 * Map a graph endpoint to what is on screen. Unattached findings only
 * resolve while "+n more" is expanded; a non-evidence asset only while
 * suggestions are shown.
 */
export function makeResolver(
  d: BoardDomain,
  view: ProjectionView,
  projected: ReadonlySet<string>,
) {
  const rowCache = new Map<string, Set<string>>();
  const rowsOf = (itemId: string): Set<string> => {
    let rows = rowCache.get(itemId);
    if (!rows) {
      const bubble = d.bubbles.get(itemId);
      const item = d.items.get(itemId);
      rows = bubble && item ? visibleRowIds(bubble, item, view) : new Set();
      rowCache.set(itemId, rows);
    }
    return rows;
  };

  const itemEnd = (itemId: string, findingId: string | null | undefined): ResolvedEnd | null => {
    if (!projected.has(itemId)) return null;
    if (findingId && rowsOf(itemId).has(findingId)) {
      const nodeId = findingNodeId(itemId, findingId);
      if (projected.has(nodeId)) return { nodeId };
    }
    return { nodeId: itemId };
  };

  const graphEnd = (key: string): ResolvedEnd | null => {
    if (key.startsWith("asset:")) {
      const assetId = key.slice(6);
      const itemId = d.itemByAsset.get(assetId);
      if (itemId) return itemEnd(itemId, null);
      const sg = `sg:${assetId}`;
      return projected.has(sg) ? { nodeId: sg } : null;
    }
    if (key.startsWith("finding:")) {
      const findingId = key.slice(8);
      const itemId = d.itemByFinding.get(findingId);
      if (!itemId) return null;
      const bubble = d.bubbles.get(itemId);
      const attached = bubble?.rows.some((r) => r.findingId === findingId);
      if (!attached && !view.expandedUnattached.has(itemId)) return null;
      return itemEnd(itemId, findingId);
    }
    return null;
  };

  return { itemEnd, graphEnd };
}

export function projectEdges(
  d: BoardDomain,
  view: ProjectionView,
  nodes: readonly BoardNode[],
): BoardEdge[] {
  const projected = new Set(nodes.filter((n) => !n.hidden).map((n) => n.id));
  const { itemEnd, graphEnd } = makeResolver(d, view, projected);
  const edges: BoardEdge[] = [];

  // A promoted board link is also a global edge now; draw it once, as the link.
  const promoted = new Set<string>();
  for (const l of d.links.values()) if (l.promotedEdgeId) promoted.add(l.promotedEdgeId);

  // System edges, parallel duplicates folded into one with a count.
  const folded = new Map<string, BoardEdge>();
  for (const e of d.systemEdges.values()) {
    if (promoted.has(e.id)) continue;
    const cls = edgeDrawClass(e);
    const manual = e.origin === "MANUAL";
    if (!manual && !view.kinds.has(edgeKind(e))) continue;
    const s = graphEnd(e.from);
    const t = graphEnd(e.to);
    if (!s || !t) continue;
    if (s.nodeId === t.nodeId) continue; // within one collapsed asset
    // An asset's own findings: the contains edges below draw that.
    if (parseFindingNodeId(t.nodeId)?.itemId === s.nodeId) continue;
    if (parseFindingNodeId(s.nodeId)?.itemId === t.nodeId) continue;
    const suggested = s.nodeId.startsWith("sg:") || t.nodeId.startsWith("sg:");
    const type: BoardEdgeType = suggested ? "suggested" : manual ? "link" : "system";
    const key = `${type}|${s.nodeId}|${t.nodeId}|${manual ? e.id : cls}`;
    const existing = folded.get(key);
    if (existing) {
      existing.data = { ...existing.data, count: (existing.data?.count ?? 1) + 1 };
      continue;
    }
    folded.set(key, {
      id: `sys:${e.id}`,
      type,
      source: s.nodeId,
      sourceHandle: SOURCE_PORT,
      target: t.nodeId,
      targetHandle: TARGET_PORT,
      deletable: false,
      reconnectable: false,
      focusable: false,
      data: { systemEdgeId: e.id, count: 1 },
    });
  }
  edges.push(...folded.values());

  for (const l of d.links.values()) {
    const s = itemEnd(l.sourceItemId, l.sourceFindingId);
    const t = itemEnd(l.targetItemId, l.targetFindingId);
    if (!s || !t) continue;
    edges.push({
      id: `lnk:${l.id}`,
      type: "link",
      source: s.nodeId,
      sourceHandle: SOURCE_PORT,
      target: t.nodeId,
      targetHandle: TARGET_PORT,
      deletable: false,
      reconnectable: false,
      data: { linkId: l.id },
    });
  }

  for (const n of nodes) {
    if (n.type !== "finding" || n.hidden || !isFindingData(n.data)) continue;
    edges.push({
      id: `ct:${n.id.slice(3)}`,
      type: "contains",
      source: n.data.findingOf,
      sourceHandle: SOURCE_PORT,
      target: n.id,
      targetHandle: TARGET_PORT,
      deletable: false,
      reconnectable: false,
      focusable: false,
      selectable: false,
      data: { ghost: !n.data.attached },
    });
  }

  for (const support of d.supports.values()) {
    if (!support.endpoint) continue;
    const thread = d.threads.get(support.threadId);
    const hypothesisItem = thread?.itemId;
    if (!hypothesisItem) continue;
    const s = itemEnd(hypothesisItem, null);
    const t = itemEnd(support.endpoint.itemId, support.endpoint.findingId);
    if (!s || !t) continue;
    edges.push({
      id: `st:${support.id}`,
      type: "stance",
      source: s.nodeId,
      sourceHandle: SOURCE_PORT,
      target: t.nodeId,
      targetHandle: TARGET_PORT,
      deletable: false,
      reconnectable: false,
      data: { supportId: support.id },
    });
  }
  return bendParallel(edges);
}

/** Edge ids by domain id, for selection and the context menu. */
export function edgeTarget(edge: Pick<BoardEdge, "id" | "data">):
  | { kind: "link"; linkId: string }
  | { kind: "system"; systemEdgeId: string }
  | { kind: "stance"; supportId: string }
  | null {
  if (edge.data?.linkId) return { kind: "link", linkId: edge.data.linkId };
  if (edge.data?.supportId) return { kind: "stance", supportId: edge.data.supportId };
  if (edge.data?.systemEdgeId) return { kind: "system", systemEdgeId: edge.data.systemEdgeId };
  return null;
}
