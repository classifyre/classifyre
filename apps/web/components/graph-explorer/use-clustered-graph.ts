"use client";

import * as React from "react";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { keyOf, nodeKey } from "./graph-types";
import type { AssetFindingStats } from "./explorer-types";
import type {
  ClusterWorkerMeta,
  ClusterWorkerRequest,
  ClusterWorkerResponse,
} from "./clustering-worker";

/** One source contributing assets to a community, with its share of them. */
export interface ClusterSourceShare {
  /** Absent on payloads predating sourceId on graph nodes. */
  id?: string;
  /** Operator-facing source name, e.g. "Enron Email Archive". */
  name?: string;
  /** Connector type enum, e.g. "S3_COMPATIBLE_STORAGE". */
  type?: string;
  assetCount: number;
}

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
  /** Sources behind the cluster's assets, biggest contributor first. */
  sources: ClusterSourceShare[];
  dominantSourceType?: string;
  dominantDetector?: string;
  label: string;
}

/** Everything a label formatter gets to work with. */
export type ClusterLabelInput = Omit<ClusterMeta, "label">;

/**
 * Default label: the connector enum and the asset count. Views that can reach
 * translations pass `formatLabel` instead and get the real source name.
 */
const defaultFormatLabel = (meta: ClusterLabelInput): string =>
  [meta.dominantSourceType ?? meta.dominantDetector, `${meta.assetCount || meta.size}`]
    .filter(Boolean)
    .join(" · ");

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

export interface ClusteringOptions {
  enabled?: boolean;
  /** Communities smaller than this render as plain nodes. */
  minClusterSize?: number;
  /** Skip clustering entirely below this node count — small graphs read fine raw. */
  minGraphSize?: number;
  /** Per-asset finding stats (from useVisibleGraph) to enrich severity mixes. */
  assetStats?: Map<string, AssetFindingStats>;
  /**
   * Renders the caption drawn under a cluster bubble. A formatter change only
   * relabels completed clusters; it does not rerun community detection.
   */
  formatLabel?: (meta: ClusterLabelInput) => string;
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
  /** True while community detection is running outside the renderer thread. */
  isClustering: boolean;
  expandCluster: (id: string) => void;
  collapseCluster: (id: string) => void;
  collapseAll: () => void;
  expandAllClusters: () => void;
}

const STANDARD_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

/**
 * Convert DTO-heavy graph data into a columnar worker message. Large labels and
 * unused DTO fields never cross the process boundary, and numeric columns are
 * transferred instead of copied by Chromium's structured-clone serializer.
 */
function buildWorkerRequest(
  nodes: GraphNodeDto[],
  edges: GraphEdgeDto[],
  minClusterSize: number,
  assetStats?: Map<string, AssetFindingStats>,
): ClusterWorkerRequest {
  const nodeCount = nodes.length;
  const nodeKeys = new Array<string>(nodeCount);
  const nodeKinds = new Uint8Array(nodeCount);
  const nodeSeverities = new Int32Array(nodeCount);
  const nodeSources = new Int32Array(nodeCount);
  const nodeDetectors = new Int32Array(nodeCount);
  const assetFindingTotals = new Uint32Array(nodeCount);
  nodeSeverities.fill(-1);
  nodeSources.fill(-1);
  nodeDetectors.fill(-1);

  const severities = [...STANDARD_SEVERITIES];
  const severityIndexes = new Map(severities.map((severity, index) => [severity, index]));
  const severityIndexOf = (severity: string): number => {
    const existing = severityIndexes.get(severity);
    if (existing !== undefined) return existing;
    const index = severities.length;
    severities.push(severity);
    severityIndexes.set(severity, index);
    return index;
  };
  for (const node of nodes) {
    if (node.type === "finding") severityIndexOf((node.severity ?? "INFO").toUpperCase());
  }
  assetStats?.forEach((stats) => {
    for (const severity of Object.keys(stats.severityCounts)) severityIndexOf(severity);
  });

  const sources: Array<{ id?: string; name?: string; type?: string }> = [];
  const sourceIndexes = new Map<string, number>();
  const detectors: string[] = [];
  const detectorIndexes = new Map<string, number>();
  const indexByNodeKey = new Map<string, number>();
  const assetSeverityCounts = new Uint32Array(nodeCount * severities.length);

  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const node = nodes[nodeIndex]!;
    const key = keyOf(node);
    nodeKeys[nodeIndex] = key;
    indexByNodeKey.set(key, nodeIndex);

    if (node.type === "asset") {
      nodeKinds[nodeIndex] = 1;
      const sourceKey = node.sourceId ?? node.sourceType ?? "";
      let sourceIndex = sourceIndexes.get(sourceKey);
      if (sourceIndex === undefined) {
        sourceIndex = sources.length;
        sourceIndexes.set(sourceKey, sourceIndex);
        sources.push({ id: node.sourceId, name: node.sourceName, type: node.sourceType });
      }
      nodeSources[nodeIndex] = sourceIndex;

      const stats = assetStats?.get(node.id);
      if (stats) {
        assetFindingTotals[nodeIndex] = stats.total;
        for (const [severity, count] of Object.entries(stats.severityCounts)) {
          const severityIndex = severityIndexes.get(severity);
          if (severityIndex !== undefined) {
            assetSeverityCounts[nodeIndex * severities.length + severityIndex] = count;
          }
        }
      }
    } else if (node.type === "finding") {
      nodeKinds[nodeIndex] = 2;
      nodeSeverities[nodeIndex] = severityIndexes.get(
        (node.severity ?? "INFO").toUpperCase(),
      )!;
      const detector = node.customDetectorName ?? node.detectorType;
      if (detector) {
        let detectorIndex = detectorIndexes.get(detector);
        if (detectorIndex === undefined) {
          detectorIndex = detectors.length;
          detectorIndexes.set(detector, detectorIndex);
          detectors.push(detector);
        }
        nodeDetectors[nodeIndex] = detectorIndex;
      }
    }
  }

  const edgeEndpoints = new Int32Array(edges.length * 2);
  const edgeWeights = new Float32Array(edges.length);
  edgeEndpoints.fill(-1);
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    const edge = edges[edgeIndex]!;
    const from = indexByNodeKey.get(nodeKey(edge.fromType, edge.fromId));
    const to = indexByNodeKey.get(nodeKey(edge.toType, edge.toId));
    if (from !== undefined && to !== undefined) {
      edgeEndpoints[edgeIndex * 2] = from;
      edgeEndpoints[edgeIndex * 2 + 1] = to;
    }
    edgeWeights[edgeIndex] = Math.max(0.01, Number(edge.confidence ?? 1));
  }

  return {
    type: "cluster",
    minClusterSize,
    nodeKeys,
    nodeKinds,
    nodeSeverities,
    nodeSources,
    nodeDetectors,
    assetFindingTotals,
    assetSeverityCounts,
    severities,
    sources,
    detectors,
    edgeEndpoints,
    edgeWeights,
  };
}

/**
 * Community detection over the visible graph (Louvain, weighted by edge
 * confidence), collapsing each sizable community into a single meta-node.
 * Graph construction, Louvain, and cluster metadata aggregation run in a Web
 * Worker so large responses cannot block the renderer's event loop.
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
  const formatLabel = options?.formatLabel ?? defaultFormatLabel;

  const [expandedClusters, setExpandedClusters] = React.useState<Set<string>>(new Set());

  const active = enabled && nodes.length >= minGraphSize;

  // A request object gives each input snapshot an identity. Results from an
  // older worker can never be applied to newer props, even if they arrive late.
  const request = React.useMemo(
    () => ({ nodes, edges, minClusterSize, assetStats }),
    [nodes, edges, minClusterSize, assetStats],
  );
  const [workerResult, setWorkerResult] = React.useState<{
    request: typeof request;
    clusters: ClusterWorkerMeta[];
    clusterOffsets: Uint32Array;
    clusterMembers: Uint32Array;
    clusterOfNode: Int32Array;
  } | null>(null);

  React.useEffect(() => {
    if (!active || nodes.length === 0) return;

    const worker = new Worker(new URL("./clustering-worker.ts", import.meta.url), {
      type: "module",
    });
    let disposed = false;
    worker.onmessage = (event: MessageEvent<ClusterWorkerResponse>) => {
      if (disposed) return;
      const response = event.data;
      if (response.type === "result") {
        setWorkerResult({
          request,
          clusters: response.clusters,
          clusterOffsets: response.clusterOffsets,
          clusterMembers: response.clusterMembers,
          clusterOfNode: response.clusterOfNode,
        });
      } else {
        console.error("Graph clustering worker failed:", response.message);
        setWorkerResult({
          request,
          clusters: [],
          clusterOffsets: new Uint32Array([0]),
          clusterMembers: new Uint32Array(),
          clusterOfNode: new Int32Array(),
        });
      }
      worker.terminate();
    };
    worker.onerror = (event) => {
      if (disposed) return;
      console.error("Graph clustering worker failed:", event.message);
      setWorkerResult({
        request,
        clusters: [],
        clusterOffsets: new Uint32Array([0]),
        clusterMembers: new Uint32Array(),
        clusterOfNode: new Int32Array(),
      });
      worker.terminate();
    };
    const message = buildWorkerRequest(nodes, edges, minClusterSize, assetStats);
    worker.postMessage(message, [
      message.nodeKinds.buffer,
      message.nodeSeverities.buffer,
      message.nodeSources.buffer,
      message.nodeDetectors.buffer,
      message.assetFindingTotals.buffer,
      message.assetSeverityCounts.buffer,
      message.edgeEndpoints.buffer,
      message.edgeWeights.buffer,
    ]);

    return () => {
      disposed = true;
      worker.terminate();
    };
  }, [active, request, nodes, edges, minClusterSize, assetStats]);

  const isClustering = active && workerResult?.request !== request;
  const { clusters, clusterOfNode } = React.useMemo(() => {
    const clusters = new Map<string, ClusterMeta>();
    const clusterOfNode = new Map<string, string>();
    if (!active || workerResult?.request !== request) {
      return { clusters, clusterOfNode };
    }

    const nodeKeys = nodes.map(keyOf);
    for (let clusterIndex = 0; clusterIndex < workerResult.clusters.length; clusterIndex += 1) {
      const rawMeta = workerResult.clusters[clusterIndex]!;
      const start = workerResult.clusterOffsets[clusterIndex]!;
      const end = workerResult.clusterOffsets[clusterIndex + 1]!;
      const memberKeys: string[] = [];
      for (let offset = start; offset < end; offset += 1) {
        const nodeIndex = workerResult.clusterMembers[offset]!;
        const key = nodeKeys[nodeIndex];
        if (key) memberKeys.push(key);
      }
      const meta: ClusterMeta = { ...rawMeta, memberKeys, label: "" };
      meta.label = formatLabel(meta);
      clusters.set(meta.id, meta);
    }
    for (let nodeIndex = 0; nodeIndex < workerResult.clusterOfNode.length; nodeIndex += 1) {
      const clusterIndex = workerResult.clusterOfNode[nodeIndex]!;
      if (clusterIndex < 0) continue;
      const key = nodeKeys[nodeIndex];
      const clusterId = workerResult.clusters[clusterIndex]?.id;
      if (key && clusterId) clusterOfNode.set(key, clusterId);
    }
    return { clusters, clusterOfNode };
  }, [active, request, workerResult, formatLabel, nodes]);

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
    // Do not briefly feed a large unclustered graph into layout while its
    // worker is running; that would move the bottleneck rather than remove it.
    if (isClustering) {
      return { renderNodes: [], renderEdges: [], hasCollapsedClusters: false };
    }
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
  }, [nodes, edges, clusters, clusterOfNode, expandedClusters, isClustering]);

  return {
    renderNodes,
    renderEdges,
    clusters,
    clusterOfNode,
    expandedClusters,
    hasCollapsedClusters,
    isClustering,
    expandCluster,
    collapseCluster,
    collapseAll,
    expandAllClusters,
  };
}
