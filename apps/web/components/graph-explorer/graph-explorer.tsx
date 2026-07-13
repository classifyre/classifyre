"use client";

import * as React from "react";
import { Maximize2, RotateCw } from "lucide-react";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { useTranslation } from "@/hooks/use-translation";
import { GraphCanvas } from "./graph-canvas";
import { useForceLayout } from "./use-force-layout";
import { usePanZoom } from "./use-pan-zoom";
import { useContainerSize } from "./use-container-size";
import { focusComponent, nodesBBox } from "./graph-utils";
import {
  keyOf,
  type GraphMode,
  type GraphSelection,
  type PathResult,
} from "./graph-types";
import type { EdgeStyleOverride, NodeDecorator } from "./explorer-types";
import {
  isClusterNode,
  useClusteredGraph,
  type ClusteredGraph,
  type ClusteringOptions,
} from "./use-clustered-graph";
import { ClusterControls } from "./cluster-controls";
import { ClusterDetailPanel, ClusterOverviewPanel } from "./cluster-panels";
import { useClusterFocus } from "./use-cluster-focus";

const SELECT_MODE: GraphMode = { kind: "select" };

/** State and helpers the shell hands to sidebar/toolbar render props. */
export interface GraphExplorerContext {
  selection: GraphSelection;
  setSelection: (s: GraphSelection) => void;
  selectedNode: GraphNodeDto | null;
  selectedEdge: GraphEdgeDto | null;
  path: PathResult | null;
  setPath: (p: PathResult | null) => void;
  clearFocus: () => void;
  zoomToFit: () => void;
  nodeIndex: Map<string, GraphNodeDto>;
  clustered: ClusteredGraph;
  hoverKey: string | null;
  setHoverKey: (key: string | null) => void;
}

export interface GraphExplorerProps {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  truncated?: boolean;
  /** Left side of the toolbar: icon, title, view-specific controls. */
  header?: React.ReactNode;
  /** Extra buttons before the built-in zoom-to-fit / reload. */
  headerRight?: React.ReactNode;
  onReload?: () => void;
  /** Rendered over the canvas (loading / error / empty states). */
  overlay?: React.ReactNode;
  /** Right-hand sidebar content; receives live explorer context. */
  sidebar?: (ctx: GraphExplorerContext) => React.ReactNode;
  sidebarClassName?: string;
  nodeDecorator?: NodeDecorator;
  edgeStyle?: (edge: GraphEdgeDto) => EdgeStyleOverride | null;
  /** Community clustering / semantic zoom (on by default for larger graphs). */
  clustering?: ClusteringOptions;
  /** Clicking a node highlights its connected component (default off). */
  focusComponentOnClick?: boolean;
  onNodeClick?: (node: GraphNodeDto, ctx: GraphExplorerContext) => void;
  onNodeDoubleClick?: (node: GraphNodeDto, ctx: GraphExplorerContext) => void;
}

/**
 * Shared interactive graph shell: force layout, pan/zoom, sizing, selection,
 * component focus, zoom-to-fit and the toolbar/sidebar frames. Views plug in
 * data, decorations and panels — see AssetLinksGraph for the smallest adapter.
 */
export function GraphExplorer({
  nodes,
  edges,
  truncated,
  header,
  headerRight,
  onReload,
  overlay,
  sidebar,
  sidebarClassName,
  nodeDecorator,
  edgeStyle,
  clustering,
  focusComponentOnClick,
  onNodeClick,
  onNodeDoubleClick,
}: GraphExplorerProps) {
  const { t } = useTranslation();
  const [selection, setSelection] = React.useState<GraphSelection>(null);
  const [path, setPath] = React.useState<PathResult | null>(null);
  const [hoverKey, setHoverKey] = React.useState<string | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const size = useContainerSize(containerRef);

  const clustered = useClusteredGraph(nodes, edges, clustering);
  const { renderNodes, renderEdges } = clustered;

  /** Fan seed positions for members of a just-expanded cluster. */
  const seedOverridesRef = React.useRef(new Map<string, { x: number; y: number }>());

  const layout = useForceLayout(renderNodes, renderEdges, size, seedOverridesRef.current);
  const panZoom = usePanZoom();

  const zoomToFit = React.useCallback(() => {
    const bbox = nodesBBox(layout.simNodes.values());
    if (bbox) panZoom.fitBBox(bbox);
  }, [layout.simNodes, panZoom]);

  // Fit once after the first simulation settles.
  const didFit = React.useRef(false);
  React.useEffect(() => {
    if (didFit.current || nodes.length === 0) return;
    layout.onSettle(() => {
      didFit.current = true;
      zoomToFit();
    });
  }, [layout, zoomToFit, nodes.length]);

  // Reset focus when the dataset changes.
  React.useEffect(() => {
    setPath(null);
    setSelection(null);
  }, [nodes]);

  const nodeIndex = React.useMemo(() => {
    const m = new Map<string, GraphNodeDto>();
    renderNodes.forEach((n) => m.set(keyOf(n), n));
    return m;
  }, [renderNodes]);

  const selectedNode =
    selection?.type === "node" ? (nodeIndex.get(selection.key) ?? null) : null;
  const selectedEdge = React.useMemo(
    () =>
      selection?.type === "edge"
        ? (renderEdges.find((e) => e.id === selection.id) ?? null)
        : null,
    [selection, renderEdges],
  );

  const clearFocus = React.useCallback(() => {
    setSelection(null);
    setPath(null);
  }, []);

  const ctx: GraphExplorerContext = {
    selection,
    setSelection,
    selectedNode,
    selectedEdge,
    path,
    setPath,
    clearFocus,
    zoomToFit,
    nodeIndex,
    clustered,
    hoverKey,
    setHoverKey,
  };

  const { expandCluster, focusCluster } = useClusterFocus({
    clustered,
    layout,
    panZoom,
    seedOverrides: seedOverridesRef.current,
    onBeforeExpand: clearFocus,
  });

  const handleNodeClick = React.useCallback(
    (node: GraphNodeDto) => {
      if (onNodeClick) {
        onNodeClick(node, ctx);
        return;
      }
      const key = keyOf(node);
      if (focusComponentOnClick && !isClusterNode(node)) {
        if (path && !path.nodeKeys.has(key)) return;
        setPath(focusComponent(key, renderEdges));
      }
      setSelection({ type: "node", key });
    },
    // ctx is rebuilt every render; the handler only closes over stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onNodeClick, focusComponentOnClick, path, renderEdges],
  );

  const handleNodeDoubleClick = React.useMemo(
    () => (node: GraphNodeDto) => {
      if (isClusterNode(node)) {
        expandCluster(node.cluster);
        return;
      }
      onNodeDoubleClick?.(node, ctx);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onNodeDoubleClick, expandCluster, selection, path],
  );

  const selectedClusterMeta =
    selectedNode && isClusterNode(selectedNode) ? selectedNode.cluster : null;

  return (
    <div className="flex h-full flex-col border-2 border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-border px-3 py-2">
        {header}
        <ClusterControls clustered={clustered} />
        {truncated && (
          <Badge variant="outline" className="text-[10px] uppercase">
            {t("graphExplorer.truncated")}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {headerRight}
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={zoomToFit}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          {onReload && (
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={onReload}>
              <RotateCw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Canvas is always mounted (so pan/zoom binds); states overlay it. */}
        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden">
          <GraphCanvas
            nodes={renderNodes}
            edges={renderEdges}
            layout={layout}
            panZoom={panZoom}
            selection={selection}
            mode={SELECT_MODE}
            activeNodeKeys={null}
            path={path}
            hoverKey={hoverKey}
            onNodeHover={(n) => setHoverKey(n ? keyOf(n) : null)}
            nodeDecorator={nodeDecorator}
            edgeStyle={edgeStyle}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onNodeContextMenu={() => undefined}
            onEdgeClick={(edge) => setSelection({ type: "edge", id: edge.id })}
            onEdgeContextMenu={() => undefined}
            onBackgroundClick={clearFocus}
          />
          {overlay && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/80 backdrop-blur-sm">
              {overlay}
            </div>
          )}
        </div>

        {(sidebar || clustered.clusters.size > 0) && (
          <aside
            className={
              sidebarClassName ??
              "w-[260px] shrink-0 space-y-4 overflow-y-auto border-l-2 border-border bg-background p-3"
            }
          >
            {selectedClusterMeta ? (
              <ClusterDetailPanel
                meta={selectedClusterMeta}
                clusters={clustered.clusters}
                renderEdges={renderEdges}
                nodeByKey={(k) => {
                  const [type, ...rest] = k.split(":");
                  const id = rest.join(":");
                  return nodes.find((n) => n.type === type && n.id === id);
                }}
                onFocusCluster={focusCluster}
                hoverKey={hoverKey}
                onHoverKey={setHoverKey}
              />
            ) : (
              <>
                {!selection && clustered.hasCollapsedClusters && (
                  <ClusterOverviewPanel
                    clusters={clustered.clusters}
                    onFocusCluster={focusCluster}
                    hoverKey={hoverKey}
                    onHoverKey={setHoverKey}
                  />
                )}
                {sidebar?.(ctx)}
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
