import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";

export const nodeKey = (type: string, id: string) => `${type}:${id}`;
export const keyOf = (n: GraphNodeDto) => nodeKey(n.type, n.id);

/** d3-force mutable wrapper around a GraphNodeDto. */
export interface SimNode {
  key: string;
  data: GraphNodeDto;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
}

export interface SimEdge {
  id: string;
  data: GraphEdgeDto;
  source: string | SimNode;
  target: string | SimNode;
  index?: number;
}

export type GraphMode =
  | { kind: "select" }
  | { kind: "connect"; sourceKey: string | null }
  | { kind: "path"; firstKey: string | null };

export type GraphSelection =
  | { type: "node"; key: string }
  | { type: "edge"; id: string }
  | null;

export interface PathResult {
  nodeKeys: Set<string>;
  edgeIds: Set<string>;
}

export const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#b91c1c",
  HIGH: "#c2410c",
  MEDIUM: "#a16207",
  LOW: "#1d4ed8",
  INFO: "#78716c",
};

export const MANUAL_EDGE_COLOR = "#d97706";
export const CROSS_HYP_COLOR = "#a855f7";
export const ACCENT = "#b7ff00";

/** Visual radius used for hit areas, collision and edge endpoint trimming. */
export function nodeRadius(node: GraphNodeDto): number {
  switch (node.type) {
    case "finding":
      return 13;
    case "sandbox":
      return 20;
    default:
      return 19;
  }
}

/** Collision radius — larger than the shape so labels keep breathing room. */
export function collideRadius(node: GraphNodeDto): number {
  return node.type === "finding" ? 34 : 52;
}
