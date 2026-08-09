import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { ClusterMeta, ClusterSourceShare } from "./use-clustered-graph";

interface ClusterWorkerSource {
  id?: string;
  name?: string;
  type?: string;
}

export interface ClusterWorkerRequest {
  type: "cluster";
  minClusterSize: number;
  nodeKeys: string[];
  /** 0 = other, 1 = asset, 2 = finding. */
  nodeKinds: Uint8Array;
  nodeSeverities: Int32Array;
  nodeSources: Int32Array;
  nodeDetectors: Int32Array;
  assetFindingTotals: Uint32Array;
  /** Row-major node × severity matrix. */
  assetSeverityCounts: Uint32Array;
  severities: string[];
  sources: ClusterWorkerSource[];
  detectors: string[];
  /** Pairs of numeric node indexes; -1 marks an invalid endpoint. */
  edgeEndpoints: Int32Array;
  edgeWeights: Float32Array;
}

export type ClusterWorkerMeta = Omit<ClusterMeta, "memberKeys" | "label">;

export type ClusterWorkerResponse =
  | {
      type: "result";
      clusters: ClusterWorkerMeta[];
      /** Start offset for every cluster, plus a final sentinel offset. */
      clusterOffsets: Uint32Array;
      /** Concatenated node indexes for all cluster memberships. */
      clusterMembers: Uint32Array;
      /** Cluster index per node, or -1 when the node is not collapsed. */
      clusterOfNode: Int32Array;
    }
  | { type: "error"; message: string };

function clusterGraph(request: ClusterWorkerRequest): Extract<
  ClusterWorkerResponse,
  { type: "result" }
> {
  const {
    nodeKeys,
    nodeKinds,
    nodeSeverities,
    nodeSources,
    nodeDetectors,
    assetFindingTotals,
    assetSeverityCounts,
    severities,
    sources: sourceCatalog,
    detectors,
    edgeEndpoints,
    edgeWeights,
    minClusterSize,
  } = request;

  const graph = new Graph({ type: "undirected", multi: true });
  for (let index = 0; index < nodeKeys.length; index += 1) {
    graph.addNode(index);
  }
  for (let edgeIndex = 0; edgeIndex < edgeWeights.length; edgeIndex += 1) {
    const from = edgeEndpoints[edgeIndex * 2]!;
    const to = edgeEndpoints[edgeIndex * 2 + 1]!;
    if (from < 0 || to < 0 || from === to) continue;
    graph.addEdge(from, to, { weight: edgeWeights[edgeIndex] });
  }

  const assignments = louvain(graph, { getEdgeWeight: "weight" });
  const byCommunity = new Map<string | number, number[]>();
  for (const [rawIndex, community] of Object.entries(assignments)) {
    const members = byCommunity.get(community) ?? [];
    members.push(Number(rawIndex));
    byCommunity.set(community, members);
  }

  const clusters: ClusterWorkerMeta[] = [];
  const offsets: number[] = [0];
  const allMembers: number[] = [];
  const clusterOfNode = new Int32Array(nodeKeys.length);
  clusterOfNode.fill(-1);
  const severityWidth = severities.length;

  for (const memberIndexes of byCommunity.values()) {
    if (memberIndexes.length < minClusterSize) continue;

    const severityCounts: Record<string, number> = {};
    const sourceCounts = new Map<number, number>();
    const detectorCounts = new Map<number, number>();
    let findingCount = 0;
    let assetCount = 0;
    let smallestKey = nodeKeys[memberIndexes[0]!]!;

    for (const nodeIndex of memberIndexes) {
      const key = nodeKeys[nodeIndex]!;
      if (key < smallestKey) smallestKey = key;

      if (nodeKinds[nodeIndex] === 2) {
        findingCount += 1;
        const severityIndex = nodeSeverities[nodeIndex]!;
        if (severityIndex >= 0) {
          const severity = severities[severityIndex]!;
          severityCounts[severity] = (severityCounts[severity] ?? 0) + 1;
        }
        const detectorIndex = nodeDetectors[nodeIndex]!;
        if (detectorIndex >= 0) {
          detectorCounts.set(
            detectorIndex,
            (detectorCounts.get(detectorIndex) ?? 0) + 1,
          );
        }
      } else if (nodeKinds[nodeIndex] === 1) {
        assetCount += 1;
        const sourceIndex = nodeSources[nodeIndex]!;
        if (sourceIndex >= 0) {
          sourceCounts.set(sourceIndex, (sourceCounts.get(sourceIndex) ?? 0) + 1);
        }
        findingCount += assetFindingTotals[nodeIndex]!;
        const severityOffset = nodeIndex * severityWidth;
        for (let severityIndex = 0; severityIndex < severityWidth; severityIndex += 1) {
          const count = assetSeverityCounts[severityOffset + severityIndex]!;
          if (count === 0) continue;
          const severity = severities[severityIndex]!;
          severityCounts[severity] = (severityCounts[severity] ?? 0) + count;
        }
      }
    }

    const clusterSources: ClusterSourceShare[] = [...sourceCounts]
      .map(([sourceIndex, count]) => ({
        ...sourceCatalog[sourceIndex],
        assetCount: count,
      }))
      .sort((left, right) => right.assetCount - left.assetCount);
    let dominantDetectorIndex = -1;
    let dominantDetectorCount = 0;
    for (const [detectorIndex, count] of detectorCounts) {
      if (count > dominantDetectorCount) {
        dominantDetectorIndex = detectorIndex;
        dominantDetectorCount = count;
      }
    }

    const id = `c-${smallestKey.replace(/[^a-z0-9]/gi, "").slice(0, 32)}`;
    const clusterIndex = clusters.length;
    clusters.push({
      id,
      size: memberIndexes.length,
      assetCount,
      findingCount,
      severityCounts,
      topSeverity: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].find(
        (severity) => severityCounts[severity],
      ),
      sources: clusterSources,
      dominantSourceType: clusterSources[0]?.type,
      dominantDetector:
        dominantDetectorIndex >= 0 ? detectors[dominantDetectorIndex] : undefined,
    });
    for (const nodeIndex of memberIndexes) {
      clusterOfNode[nodeIndex] = clusterIndex;
      allMembers.push(nodeIndex);
    }
    offsets.push(allMembers.length);
  }

  return {
    type: "result",
    clusters,
    clusterOffsets: Uint32Array.from(offsets),
    clusterMembers: Uint32Array.from(allMembers),
    clusterOfNode,
  };
}

self.onmessage = (event: MessageEvent<ClusterWorkerRequest>) => {
  try {
    const response = clusterGraph(event.data);
    self.postMessage(response, [
      response.clusterOffsets.buffer,
      response.clusterMembers.buffer,
      response.clusterOfNode.buffer,
    ]);
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies ClusterWorkerResponse);
  }
};
