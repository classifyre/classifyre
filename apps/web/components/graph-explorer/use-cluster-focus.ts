"use client";

import * as React from "react";
import { fanPositions } from "./graph-utils";
import { clusterNodeKey, type ClusteredGraph, type ClusterMeta } from "./use-clustered-graph";
import type { useForceLayout } from "./use-force-layout";
import type { usePanZoom } from "./use-pan-zoom";

/**
 * Shared cluster drill-down behavior: expand a community with its members
 * seeded as a fan around the meta-node's position, optionally zooming the
 * viewport onto the freshly opened neighborhood.
 */
export function useClusterFocus({
  clustered,
  layout,
  panZoom,
  seedOverrides,
  onBeforeExpand,
}: {
  clustered: ClusteredGraph;
  layout: ReturnType<typeof useForceLayout>;
  panZoom: ReturnType<typeof usePanZoom>;
  seedOverrides: Map<string, { x: number; y: number }>;
  /** Clear view-specific focus state (selection, path) before the expand. */
  onBeforeExpand?: () => void;
}) {
  const fanRadiusFor = (meta: ClusterMeta) =>
    Math.max(110, (meta.memberKeys.length * 40) / (2 * Math.PI));

  const expandCluster = React.useCallback(
    (meta: ClusterMeta) => {
      const center = layout.simNodes.get(clusterNodeKey(meta.id));
      if (center) {
        const positions = fanPositions(center, meta.memberKeys.length, 110);
        meta.memberKeys.forEach((k, i) => seedOverrides.set(k, positions[i]!));
      }
      onBeforeExpand?.();
      clustered.expandCluster(meta.id);
    },
    [clustered, layout.simNodes, seedOverrides, onBeforeExpand],
  );

  const focusCluster = React.useCallback(
    (meta: ClusterMeta) => {
      const center = layout.simNodes.get(clusterNodeKey(meta.id));
      expandCluster(meta);
      if (center) {
        const r = fanRadiusFor(meta) + 160;
        panZoom.fitBBox({ x: center.x - r, y: center.y - r, w: r * 2, h: r * 2 });
      }
    },
    [expandCluster, layout.simNodes, panZoom],
  );

  return { expandCluster, focusCluster };
}
