import type { GraphNodeDto } from "@workspace/api-client";

/**
 * Per-node visual extras supplied by a view adapter. The canvas itself knows
 * nothing about evidence, hypotheses, external assets or similarity strength —
 * each view expresses those concerns as a decoration.
 */
export interface NodeBadge {
  id: string;
  text: string;
  /** Corner relative to the node: top-right or bottom-right. */
  placement: "tr" | "br";
  /** Accent badges use the accent fill (attach-findings style). */
  accent?: boolean;
}

export interface SeverityArc {
  color: string;
  fraction: number;
}

export interface NodeDecoration {
  /** Proportional severity ring segments (asset finding mix). */
  severityArcs?: SeverityArc[];
  /** Solid ring around the node (evidence, external asset). */
  ringColor?: string;
  /** Dashed ring (cross-hypothesis membership). */
  dashedRingColor?: string;
  /** Small colored dots above the node (hypothesis membership). */
  dots?: string[];
  /** Clickable corner badges; clicks arrive via onBadgeClick(node, badgeId). */
  badges?: NodeBadge[];
  /** Fill override for finding nodes (similarity heat). */
  fillOverride?: string;
  /** Finding glyph: category code text (default) or detector icon. */
  findingGlyph?: "code" | "icon";
}

export interface EdgeStyleOverride {
  stroke?: string;
  dash?: number[];
  width?: number;
  arrow?: boolean;
  /**
   * Text drawn at the edge midpoint instead of `relationType`.
   *
   * A lineage view wants to print the subtype a person recognises ("derived",
   * "copy") rather than the stored relation type, and a collapsed cluster edge
   * wants to print how many edges it stands for.
   */
  label?: string;
  /**
   * Bow the edge sideways, as a fraction of its length. Two nodes can be joined
   * by several edges at once — one per class — and drawn straight they land on
   * top of each other and read as one.
   */
  curvature?: number;
}

export type NodeDecorator = (node: GraphNodeDto) => NodeDecoration | null;

/**
 * Aggregated per-asset finding stats, derived client-side from finding nodes.
 * Used for the severity donut and count badge on asset nodes.
 */
export interface AssetFindingStats {
  /** severity (uppercase) → count */
  severityCounts: Record<string, number>;
  total: number;
}
