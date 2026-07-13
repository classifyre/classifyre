"use client";

import * as React from "react";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { keyOf, nodeKey } from "./graph-types";
import type { AssetFindingStats } from "./explorer-types";

export interface UseVisibleGraphOptions {
  /**
   * Start with all assets expanded (legacy behavior). Default false: findings
   * stay aggregated into their asset's severity donut until drilled into.
   */
  defaultExpanded?: boolean;
  /** Findings never shown on canvas (e.g. not attached to the case). */
  hideFinding?: (n: GraphNodeDto) => boolean;
}

export interface VisibleGraph {
  visibleNodes: GraphNodeDto[];
  visibleKeys: Set<string>;
  /**
   * Edges adjusted for visibility: an endpoint at a hidden finding is
   * re-routed to its parent asset so the relationship stays observable;
   * duplicates produced by the re-routing collapse into one line.
   */
  visibleEdges: GraphEdgeDto[];
  /** Collapsible findings hidden per asset id (drives the ▸n badge). */
  collapsedCounts: Map<string, number>;
  /** Severity mix + total of an asset's (non-hidden) findings — donut data. */
  assetStats: Map<string, AssetFindingStats>;
  isAssetExpanded: (assetId: string) => boolean;
  toggleAssetExpanded: (assetId: string) => void;
  expandedDefault: boolean;
  toggleExpandedDefault: () => void;
}

/**
 * Aggregates finding nodes under their parent asset with per-asset
 * expand/collapse. Collapsed is the default: 100 assets with 355 findings
 * render as 100 donut-ringed assets instead of a 455-node hairball.
 */
export function useVisibleGraph(
  nodes: GraphNodeDto[],
  edges: GraphEdgeDto[],
  options?: UseVisibleGraphOptions,
): VisibleGraph {
  const hideFinding = options?.hideFinding;
  const [expandedDefault, setExpandedDefault] = React.useState(options?.defaultExpanded ?? false);
  const [expandOverrides, setExpandOverrides] = React.useState<Map<string, boolean>>(new Map());

  const isAssetExpanded = React.useCallback(
    (assetId: string) => expandOverrides.get(assetId) ?? expandedDefault,
    [expandOverrides, expandedDefault],
  );
  const toggleAssetExpanded = React.useCallback(
    (assetId: string) =>
      setExpandOverrides((prev) => {
        const next = new Map(prev);
        next.set(assetId, !(prev.get(assetId) ?? expandedDefault));
        return next;
      }),
    [expandedDefault],
  );
  const toggleExpandedDefault = React.useCallback(() => {
    setExpandedDefault((v) => !v);
    setExpandOverrides(new Map());
  }, []);

  const nodeIndex = React.useMemo(() => {
    const m = new Map<string, GraphNodeDto>();
    nodes.forEach((n) => m.set(keyOf(n), n));
    return m;
  }, [nodes]);

  /** Collapsible = finding anchored to an asset and not hidden outright. */
  const collapsibleByAsset = React.useMemo(() => {
    const m = new Map<string, GraphNodeDto[]>();
    nodes.forEach((n) => {
      if (n.type !== "finding" || !n.assetId) return;
      if (hideFinding?.(n)) return;
      const arr = m.get(n.assetId) ?? [];
      arr.push(n);
      m.set(n.assetId, arr);
    });
    return m;
  }, [nodes, hideFinding]);

  const assetStats = React.useMemo(() => {
    const m = new Map<string, AssetFindingStats>();
    collapsibleByAsset.forEach((findings, assetId) => {
      const severityCounts: Record<string, number> = {};
      for (const f of findings) {
        const sev = (f.severity ?? "INFO").toUpperCase();
        severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;
      }
      m.set(assetId, { severityCounts, total: findings.length });
    });
    return m;
  }, [collapsibleByAsset]);

  const visibleNodes = React.useMemo(
    () =>
      nodes.filter((n) => {
        if (n.type !== "finding") return true;
        if (hideFinding?.(n)) return false;
        return n.assetId ? isAssetExpanded(n.assetId) : true;
      }),
    [nodes, hideFinding, isAssetExpanded],
  );

  const visibleKeys = React.useMemo(() => new Set(visibleNodes.map(keyOf)), [visibleNodes]);

  const collapsedCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    collapsibleByAsset.forEach((findings, assetId) => {
      if (!isAssetExpanded(assetId)) m.set(assetId, findings.length);
    });
    return m;
  }, [collapsibleByAsset, isAssetExpanded]);

  const visibleEdges = React.useMemo(() => {
    const remap = (type: string, id: string): { type: string; id: string } | null => {
      const k = nodeKey(type, id);
      if (visibleKeys.has(k)) return { type, id };
      if (type !== "finding") return null;
      const assetId = nodeIndex.get(k)?.assetId;
      if (assetId && visibleKeys.has(nodeKey("asset", assetId))) return { type: "asset", id: assetId };
      return null;
    };
    const seen = new Set<string>();
    const out: GraphEdgeDto[] = [];
    for (const e of edges) {
      const from = remap(e.fromType, e.fromId);
      const to = remap(e.toType, e.toId);
      if (!from || !to) continue;
      if (from.type === to.type && from.id === to.id) continue;
      const remapped =
        from.id !== e.fromId || to.id !== e.toId || from.type !== e.fromType || to.type !== e.toType;
      if (remapped) {
        const dedupe = `${from.type}:${from.id}|${to.type}:${to.id}|${e.relationType}|${e.origin}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({ ...e, fromType: from.type, fromId: from.id, toType: to.type, toId: to.id });
      } else {
        out.push(e);
      }
    }
    return out;
  }, [edges, visibleKeys, nodeIndex]);

  return {
    visibleNodes,
    visibleKeys,
    visibleEdges,
    collapsedCounts,
    assetStats,
    isAssetExpanded,
    toggleAssetExpanded,
    expandedDefault,
    toggleExpandedDefault,
  };
}
