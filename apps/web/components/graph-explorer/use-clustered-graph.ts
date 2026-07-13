"use client";

import * as React from "react";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { keyOf, nodeKey } from "./graph-types";
import type { AssetFindingStats } from "./explorer-types";

/** Aggregate metadata for one detected community. */
export interface ClusterMeta {
  id: string;
  memberKeys: string[];
  size: number;
  /** Assets among the members. */
  assetCount: number;
  /** Findings represented in the cluster (member findings + collapsed stats). */
  findingCount: number;
  severityCounts: Record<string, number>;
  topSeverity?: string;
  dominantSourceType?: string;
  dominantDetector?: string;
  label: string;
}

/** Pseudo graph node standing in for a collapsed community. */
export interface ClusterNode extends GraphNodeDto {
  cluster: ClusterMeta;
}

export function isClusterNode(n: GraphNodeDto): n is ClusterNode {
  return n.type === "cluster";
}

/** Pseudo edge aggregating all links between two collapsed communities. */
export interface MetaEdge extends GraphEdgeDto {
  meta: { linkCount: number; maxConfidence: number };
}

export function isMetaEdge(e: GraphEdgeDto): e is MetaEdge {
  return "meta" in e;
}

export const clusterNodeKey = (clusterId: string) => nodeKey("cluster", clusterId);

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

export interface ClusteringOptions {
  enabled?: boolean;
  /** Communities smaller than this render as plain nodes. */
  minClusterSize?: number;
  /** Skip clustering entirely below this node count — small graphs read fine raw. */
  minGraphSize?: number;
  /** Per-asset finding stats (from useVisibleGraph) to enrich severity mixes. */
  assetStats?: Map<string, AssetFindingStats>;
}

export interface ClusteredGraph {
  /** Nodes to lay out and draw: plain nodes + one ClusterNode per collapsed community. */
  renderNodes: GraphNodeDto[];
  /** Edges to draw: pass-through edges + aggregated MetaEdges. */
  renderEdges: GraphEdgeDto[];
  /** Collapsible communities (≥ minClusterSize), keyed by cluster id. */
  clusters: Map<string, ClusterMeta>;
  /** node key → cluster id, for every member of a collapsible community. */
  clusterOfNode: Map<string, string>;
  expandedClusters: Set<string>;
  /** True when at least one community is currently collapsed. */
  hasCollapsedClusters: boolean;
  expandCluster: (id: string) => void;
  collapseCluster: (id: string) => void;
  collapseAll: () => void;
  expandAllClusters: () => void;
}

const mode = (values: Array<string | undefined>): string | undefined => {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  });
  return best;
};

/**
 * Community detection over the visible graph (Louvain, weighted by edge
 * confidence), collapsing each sizable community into a single meta-node.
 * Runs synchronously in a memo: server responses cap at a few hundred nodes,
 * where Louvain finishes in single-digit milliseconds.
 *
 * Expansion state survives data reloads by member overlap: a recomputed
 * community that shares >50% of its members with a previously expanded one
 * stays expanded (keeps the user's drill-down stable across case expansion).
 */
export function useClusteredGraph(
  nodes: GraphNodeDto[],
  edges: GraphEdgeDto[],
  options?: ClusteringOptions,
): ClusteredGraph {
  const enabled = options?.enabled ?? true;
  const minClusterSize = options?.minClusterSize ?? 5;
  const minGraphSize = options?.minGraphSize ?? 40;
  const assetStats = options?.assetStats;

  const [expandedClusters, setExpandedClusters] = React.useState<Set<string>>(new Set());

  const active = enabled && nodes.length >= minGraphSize;

  // ── Community assignment (memoized per topology) ─────────────────────────
  const { clusters, clusterOfNode } = React.useMemo(() => {
    const clusters = new Map<string, ClusterMeta>();
    const clusterOfNode = new Map<string, string>();
    if (!active || nodes.length === 0) return { clusters, clusterOfNode };

    const g = new Graph({ type: "undirected", multi: true });
    for (const n of nodes) g.addNode(keyOf(n));
    for (const e of edges) {
      const a = nodeKey(e.fromType, e.fromId);
      const b = nodeKey(e.toType, e.toId);
      if (!g.hasNode(a) || !g.hasNode(b) || a === b) continue;
      g.addEdge(a, b, { weight: Math.max(0.01, Number(e.confidence ?? 1)) });
    }

    const assignments = louvain(g, { getEdgeWeight: "weight" });

    const byCommunity = new Map<string | number, string[]>();
    for (const [key, community] of Object.entries(assignments)) {
      const arr = byCommunity.get(community) ?? [];
      arr.push(key);
      byCommunity.set(community, arr);
    }

    const nodeByKey = new Map(nodes.map((n) => [keyOf(n), n]));
    for (const memberKeys of byCommunity.values()) {
      if (memberKeys.length < minClusterSize) continue;
      const members = memberKeys
        .map((k) => nodeByKey.get(k))
        .filter((n): n is GraphNodeDto => Boolean(n));

      const severityCounts: Record<string, number> = {};
      let findingCount = 0;
      let assetCount = 0;
      for (const m of members) {
        if (m.type === "finding") {
          findingCount += 1;
          const sev = (m.severity ?? "INFO").toUpperCase();
          severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;
        } else if (m.type === "asset") {
          assetCount += 1;
          const stats = assetStats?.get(m.id);
          if (stats) {
            findingCount += stats.total;
            for (const [sev, count] of Object.entries(stats.severityCounts)) {
              severityCounts[sev] = (severityCounts[sev] ?? 0) + count;
            }
          }
        }
      }
      const topSeverity = SEVERITY_ORDER.find((s) => severityCounts[s]);
      const dominantSourceType = mode(
        members.filter((m) => m.type === "asset").map((m) => m.sourceType),
      );
      const dominantDetector = mode(
        members
          .filter((m) => m.type === "finding")
          .map((m) => m.customDetectorName ?? m.detectorType),
      );

      // Stable id: the lexicographically smallest member key anchors the
      // cluster identity across recomputes of the same data.
      const id = `c-${memberKeys.slice().sort()[0]!.replace(/[^a-z0-9]/gi, "").slice(0, 32)}`;
      const label = [dominantSourceType ?? dominantDetector, `${assetCount || memberKeys.length}`]
        .filter(Boolean)
        .join(" · ");

      const meta: ClusterMeta = {
        id,
        memberKeys,
        size: memberKeys.length,
        assetCount,
        findingCount,
        severityCounts,
        topSeverity,
        dominantSourceType,
        dominantDetector,
        label,
      };
      clusters.set(id, meta);
      for (const k of memberKeys) clusterOfNode.set(k, id);
    }
    return { clusters, clusterOfNode };
  }, [active, nodes, edges, minClusterSize, assetStats]);

  // ── Carry expansion across recomputes by member overlap ──────────────────
  const prevClustersRef = React.useRef<Map<string, ClusterMeta>>(new Map());
  const prevExpandedRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const prevClusters = prevClustersRef.current;
    const prevExpanded = prevExpandedRef.current;
    prevClustersRef.current = clusters;
    if (prevClusters === clusters) return;

    const expandedMemberSets = [...prevExpanded]
      .map((id) => prevClusters.get(id))
      .filter((c): c is ClusterMeta => Boolean(c))
      .map((c) => new Set(c.memberKeys));

    const next = new Set<string>();
    clusters.forEach((meta, id) => {
      if (prevExpanded.has(id)) {
        next.add(id);
        return;
      }
      for (const prevMembers of expandedMemberSets) {
        let overlap = 0;
        for (const k of meta.memberKeys) if (prevMembers.has(k)) overlap += 1;
        if (overlap * 2 > meta.size) {
          next.add(id);
          break;
        }
      }
    });
    setExpandedClusters(next);
    prevExpandedRef.current = next;
  }, [clusters]);

  const setExpanded = React.useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setExpandedClusters((prev) => {
      const next = updater(prev);
      prevExpandedRef.current = next;
      return next;
    });
  }, []);

  const expandCluster = React.useCallback(
    (id: string) => setExpanded((prev) => new Set(prev).add(id)),
    [setExpanded],
  );
  const collapseCluster = React.useCallback(
    (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    [setExpanded],
  );
  const collapseAll = React.useCallback(() => setExpanded(() => new Set()), [setExpanded]);
  const expandAllClusters = React.useCallback(
    () => setExpanded(() => new Set(clusters.keys())),
    [setExpanded, clusters],
  );

  // ── Render graph (collapse communities into meta nodes/edges) ────────────
  const { renderNodes, renderEdges, hasCollapsedClusters } = React.useMemo(() => {
    if (clusters.size === 0) {
      return { renderNodes: nodes, renderEdges: edges, hasCollapsedClusters: false };
    }

    const collapsedOf = (key: string): string | null => {
      const cid = clusterOfNode.get(key);
      return cid && !expandedClusters.has(cid) ? cid : null;
    };

    const renderNodes: GraphNodeDto[] = [];
    const emittedClusters = new Set<string>();
    let collapsed = false;
    for (const n of nodes) {
      const cid = collapsedOf(keyOf(n));
      if (!cid) {
        renderNodes.push(n);
        continue;
      }
      collapsed = true;
      if (!emittedClusters.has(cid)) {
        emittedClusters.add(cid);
        const meta = clusters.get(cid)!;
        const clusterNode: ClusterNode = {
          id: cid,
          type: "cluster",
          label: meta.label,
          depth: 0,
          cluster: meta,
        };
        renderNodes.push(clusterNode);
      }
    }

    const metaEdges = new Map<string, MetaEdge>();
    const renderEdges: GraphEdgeDto[] = [];
    for (const e of edges) {
      const fromCid = collapsedOf(nodeKey(e.fromType, e.fromId));
      const toCid = collapsedOf(nodeKey(e.toType, e.toId));
      if (!fromCid && !toCid) {
        renderEdges.push(e);
        continue;
      }
      const from = fromCid
        ? { type: "cluster", id: fromCid }
        : { type: e.fromType, id: e.fromId };
      const to = toCid ? { type: "cluster", id: toCid } : { type: e.toType, id: e.toId };
      if (from.type === to.type && from.id === to.id) continue; // internal edge

      const a = nodeKey(from.type, from.id);
      const b = nodeKey(to.type, to.id);
      const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
      const existing = metaEdges.get(pair);
      const confidence = Number(e.confidence ?? 0);
      if (existing) {
        existing.meta.linkCount += 1;
        existing.meta.maxConfidence = Math.max(existing.meta.maxConfidence, confidence);
        existing.confidence = existing.meta.maxConfidence;
        existing.relationType = `×${existing.meta.linkCount}`;
      } else {
        const metaEdge: MetaEdge = {
          ...e,
          id: `meta:${pair}`,
          fromType: from.type,
          fromId: from.id,
          toType: to.type,
          toId: to.id,
          relationType: "×1",
          origin: e.origin,
          crossHypothesis: false,
          meta: { linkCount: 1, maxConfidence: confidence },
        };
        metaEdges.set(pair, metaEdge);
      }
    }
    metaEdges.forEach((me) => renderEdges.push(me));

    return { renderNodes, renderEdges, hasCollapsedClusters: collapsed };
  }, [nodes, edges, clusters, clusterOfNode, expandedClusters]);

  return {
    renderNodes,
    renderEdges,
    clusters,
    clusterOfNode,
    expandedClusters,
    hasCollapsedClusters,
    expandCluster,
    collapseCluster,
    collapseAll,
    expandAllClusters,
  };
}
