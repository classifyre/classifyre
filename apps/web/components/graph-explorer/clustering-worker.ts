import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import type { AssetFindingStats } from "./explorer-types";
import { keyOf, nodeKey } from "./graph-types";
import type {
  ClusterMeta,
  ClusterSourceShare,
} from "./use-clustered-graph";

export interface ClusterWorkerRequest {
  type: "cluster";
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  minClusterSize: number;
  assetStats: Array<[string, AssetFindingStats]>;
}

export type ClusterWorkerResponse =
  | {
      type: "result";
      clusters: ClusterMeta[];
      clusterOfNode: Array<[string, string]>;
    }
  | { type: "error"; message: string };

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

const mode = (values: Array<string | undefined>): string | undefined => {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
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

function clusterGraph({
  nodes,
  edges,
  minClusterSize,
  assetStats: assetStatsEntries,
}: ClusterWorkerRequest): Extract<ClusterWorkerResponse, { type: "result" }> {
  const graph = new Graph({ type: "undirected", multi: true });
  for (const node of nodes) graph.addNode(keyOf(node));
  for (const edge of edges) {
    const from = nodeKey(edge.fromType, edge.fromId);
    const to = nodeKey(edge.toType, edge.toId);
    if (!graph.hasNode(from) || !graph.hasNode(to) || from === to) continue;
    graph.addEdge(from, to, {
      weight: Math.max(0.01, Number(edge.confidence ?? 1)),
    });
  }

  const assignments = louvain(graph, { getEdgeWeight: "weight" });
  const byCommunity = new Map<string | number, string[]>();
  for (const [key, community] of Object.entries(assignments)) {
    const members = byCommunity.get(community) ?? [];
    members.push(key);
    byCommunity.set(community, members);
  }

  const assetStats = new Map(assetStatsEntries);
  const nodeByKey = new Map(nodes.map((node) => [keyOf(node), node]));
  const clusters: ClusterMeta[] = [];
  const clusterOfNode: Array<[string, string]> = [];

  for (const memberKeys of byCommunity.values()) {
    if (memberKeys.length < minClusterSize) continue;
    const members = memberKeys
      .map((key) => nodeByKey.get(key))
      .filter((node): node is GraphNodeDto => Boolean(node));

    const severityCounts: Record<string, number> = {};
    const sourceShares = new Map<string, ClusterSourceShare>();
    let findingCount = 0;
    let assetCount = 0;

    for (const member of members) {
      if (member.type === "finding") {
        findingCount += 1;
        const severity = (member.severity ?? "INFO").toUpperCase();
        severityCounts[severity] = (severityCounts[severity] ?? 0) + 1;
      } else if (member.type === "asset") {
        assetCount += 1;
        const shareKey = member.sourceId ?? member.sourceType ?? "";
        const share = sourceShares.get(shareKey);
        if (share) {
          share.assetCount += 1;
        } else {
          sourceShares.set(shareKey, {
            id: member.sourceId,
            name: member.sourceName,
            type: member.sourceType,
            assetCount: 1,
          });
        }

        const stats = assetStats.get(member.id);
        if (stats) {
          findingCount += stats.total;
          for (const [severity, count] of Object.entries(stats.severityCounts)) {
            severityCounts[severity] = (severityCounts[severity] ?? 0) + count;
          }
        }
      }
    }

    const sources = [...sourceShares.values()].sort(
      (left, right) => right.assetCount - left.assetCount,
    );
    const id = `c-${memberKeys
      .slice()
      .sort()[0]!
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 32)}`;
    const meta: ClusterMeta = {
      id,
      memberKeys,
      size: memberKeys.length,
      assetCount,
      findingCount,
      severityCounts,
      topSeverity: SEVERITY_ORDER.find((severity) => severityCounts[severity]),
      sources,
      dominantSourceType: sources[0]?.type,
      dominantDetector: mode(
        members
          .filter((member) => member.type === "finding")
          .map((member) => member.customDetectorName ?? member.detectorType),
      ),
      // Functions cannot cross the worker boundary. The hook applies the
      // current localized formatter when it materializes the response.
      label: "",
    };
    clusters.push(meta);
    for (const key of memberKeys) clusterOfNode.push([key, id]);
  }

  return { type: "result", clusters, clusterOfNode };
}

self.onmessage = (event: MessageEvent<ClusterWorkerRequest>) => {
  try {
    self.postMessage(clusterGraph(event.data) satisfies ClusterWorkerResponse);
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies ClusterWorkerResponse);
  }
};
