"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Ban,
  Fingerprint,
  Globe,
  Info,
  Maximize2,
  RotateCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  api,
  type AssetSimilarityDto,
  type GraphEdgeDto,
  type GraphNodeDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Input } from "@workspace/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Slider } from "@workspace/ui/components/slider";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components/multi-select";
import { GraphCanvas } from "./graph-explorer/graph-canvas";
import { useForceLayout } from "./graph-explorer/use-force-layout";
import { usePanZoom } from "./graph-explorer/use-pan-zoom";
import { focusComponent, nodesBBox } from "./graph-explorer/graph-utils";
import { useClusterFocus } from "./graph-explorer/use-cluster-focus";
import { useContainerSize } from "./graph-explorer/use-container-size";
import {
  isClusterNode,
  isMetaEdge,
  useClusteredGraph,
} from "./graph-explorer/use-clustered-graph";
import { ClusterControls } from "./graph-explorer/cluster-controls";
import {
  keyOf,
  nodeKey,
  type GraphSelection,
  type PathResult,
  strengthColor,
} from "./graph-explorer/graph-types";
import type { EdgeStyleOverride, NodeDecoration } from "./graph-explorer/explorer-types";
import { CorrelationTuningDialog } from "./correlation-tuning-dialog";
import { FingerprintsCaseDialog } from "./fingerprints-case-dialog";
import {
  FingerprintsGraphOverviewFooter,
  FingerprintsGraphSelectionRail,
} from "./fingerprints-graph-rail";
import { useTranslation } from "@/hooks/use-translation";

const SELECT_MODE = { kind: "select" } as const;
/** Collapse a group of shared-value nodes when it exceeds this many. */
const COLLAPSE_THRESHOLD = 5;
const BUNDLE_NODE_PREFIX = "bundle-node:";
const BUNDLE_EDGE_PREFIX = "bundle-edge:";

export interface BundleDetail {
  assetIds: string[];
  values: Array<{ label: string; value: string }>;
  /** Pairwise weighted match % (only for 2-asset bundles). */
  matchPercent?: number;
}

/** Raw graph payload, shared between the graph and its sibling panels (e.g. Connections). */
export interface FingerprintsGraphData {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  similarities: AssetSimilarityDto[];
  truncated: boolean;
}

/** Snapshot pushed up when `externalRail` is set, so a host page can render the rail itself. */
export interface FingerprintsRailState {
  selection: GraphSelection;
  selectionRail: React.ReactNode;
  /** Deselect (back affordance) — clears the graph's node/edge/bundle selection. */
  onBack: () => void;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The correlation ("evidence fingerprints") graph. Reuses the case-graph canvas
 * to render the bipartite Asset ↔ shared-value ↔ Asset structure from
 * GET /correlation/graph. Pure-UI conveniences on top: source/label filtering,
 * a tuning dialog, case actions, and bundling of dense shared-value groups into
 * a single clickable "N shared values" element to cut visual noise.
 */
export function FingerprintsGraph({
  assetId,
  sourceId,
  onTune,
  pendingRecomputeAt,
  graphData,
  graphLoading,
  graphError,
  onReloadGraph,
  externalRail = false,
  onRailStateChange,
  focusPair,
  onExitFocusPair,
}: {
  assetId?: string;
  /** Scope to a source's clusters; external assets get a show/hide toggle. */
  sourceId?: string;
  /** When set, the toolbar "Tune" button calls this instead of opening a dialog. */
  onTune?: () => void;
  /** Bump (e.g. timestamp) to make the graph wait for a recompute + reload. */
  pendingRecomputeAt?: number;
  /** Externally-fetched graph payload (shared with sibling panels). Falls back to an internal fetch when omitted. */
  graphData?: FingerprintsGraphData;
  graphLoading?: boolean;
  graphError?: string | null;
  /** Called instead of the internal fetch when `graphData` is externally managed. */
  onReloadGraph?: () => void;
  /** When true, suppress the built-in right rail and report its content via `onRailStateChange` instead. */
  externalRail?: boolean;
  onRailStateChange?: (state: FingerprintsRailState) => void;
  /** Show only these two assets, their shared-value nodes, and the connecting edges. */
  focusPair?: [string, string];
  /** Clear `focusPair` — invoked from the floating pill's Reset and from a background click. */
  onExitFocusPair?: () => void;
}) {
  const { t } = useTranslation();
  const externallyManaged = graphData !== undefined;
  const [fetchedNodes, setFetchedNodes] = React.useState<GraphNodeDto[]>([]);
  const [fetchedEdges, setFetchedEdges] = React.useState<GraphEdgeDto[]>([]);
  const [fetchedSimilarities, setFetchedSimilarities] = React.useState<AssetSimilarityDto[]>([]);
  const [fetchedTruncated, setFetchedTruncated] = React.useState(false);
  const [fetchLoading, setFetchLoading] = React.useState(true);
  const [fetchError, setFetchError] = React.useState<string | null>(null);

  const nodes = externallyManaged ? graphData.nodes : fetchedNodes;
  const edges = externallyManaged ? graphData.edges : fetchedEdges;
  const similarities = externallyManaged ? graphData.similarities : fetchedSimilarities;
  const truncated = externallyManaged ? graphData.truncated : fetchedTruncated;
  const loading = externallyManaged ? (graphLoading ?? false) : fetchLoading;
  const error = externallyManaged ? (graphError ?? null) : fetchError;

  const [recomputing, setRecomputing] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [sourceFilter, setSourceFilter] = React.useState<string[]>([]);
  const [labelFilter, setLabelFilter] = React.useState<string[]>([]);
  const [minSimilarity, setMinSimilarity] = React.useState(0);
  const [showExternal, setShowExternal] = React.useState(false);
  const [selection, setSelection] = React.useState<GraphSelection>(null);
  // Focused component ("path") around the last-clicked node; dims everything else.
  const [path, setPath] = React.useState<PathResult | null>(null);
  const [tuneOpen, setTuneOpen] = React.useState(false);
  const [caseOpen, setCaseOpen] = React.useState(false);
  const [ctxMenu, setCtxMenu] = React.useState<{
    x: number;
    y: number;
    node: GraphNodeDto;
  } | null>(null);

  const clearFocus = React.useCallback(() => {
    setPath(null);
    setSelection(null);
    setCtxMenu(null);
  }, []);

  // Right-click a real shared-value node → quick-exclude it from correlation.
  const onNodeContextMenu = React.useCallback(
    (node: GraphNodeDto, x: number, y: number) => {
      if (
        node.type !== "finding" ||
        node.detectorType === "BUNDLE" ||
        node.id.startsWith("bundle-node:")
      ) {
        return;
      }
      setCtxMenu({ x, y, node });
    },
    [],
  );

  const load = React.useCallback(() => {
    if (externallyManaged) {
      onReloadGraph?.();
      return () => undefined;
    }
    let active = true;
    setFetchLoading(true);
    setFetchError(null);
    const req = assetId ? { assetId } : sourceId ? { sourceId } : {};
    api.correlation
      .correlationControllerGraph(req)
      .then((g) => {
        if (!active) return;
        setFetchedNodes(g.nodes ?? []);
        setFetchedEdges(g.edges ?? []);
        setFetchedSimilarities(g.similarities ?? []);
        setFetchedTruncated(Boolean(g.truncated));
      })
      .catch((e: unknown) => {
        if (active)
          setFetchError(
            e instanceof Error ? e.message : t("correlation.fingerprints.loadFailed"),
          );
      })
      .finally(() => {
        if (active) setFetchLoading(false);
      });
    return () => {
      active = false;
    };
  }, [externallyManaged, onReloadGraph, assetId, sourceId, t]);

  React.useEffect(() => {
    if (externallyManaged) return;
    return load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externallyManaged, assetId, sourceId]);

  /**
   * After a config/exclusion change the recompute runs as a background
   * DUPLICATES run. Poll until a run started after `since` finishes, then
   * reload — so the graph never shows the stale pre-recompute state.
   */
  const waitForRecompute = React.useCallback(
    async (since: number) => {
      setRecomputing(true);
      const deadline = Date.now() + 90_000;
      try {
        // small grace so the job is enqueued/visible
        await new Promise((r) => setTimeout(r, 800));
        while (Date.now() < deadline) {
          let done = false;
          try {
            const res = await api.autopilot.autopilotControllerListRuns({
              agentKind: "DUPLICATES",
              limit: 5,
            });
            done = (res.items ?? []).some(
              (r) =>
                ["COMPLETED", "FAILED", "SKIPPED", "CANCELLED"].includes(
                  r.status,
                ) && new Date(r.createdAt).getTime() >= since - 2000,
            );
          } catch {
            done = true; // can't poll → stop waiting, just refresh
          }
          if (done) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
      } finally {
        load();
        setRecomputing(false);
      }
    },
    [load],
  );

  // External trigger (e.g. the Tune tab saved) → wait for recompute + reload.
  React.useEffect(() => {
    if (pendingRecomputeAt) void waitForRecompute(pendingRecomputeAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRecomputeAt]);

  const exclude = React.useCallback(
    async (node: GraphNodeDto, mode: "value" | "label") => {
      setCtxMenu(null);
      const since = Date.now();
      try {
        await api.correlation.correlationControllerAddExclusion({
          addExclusionDto: {
            mode,
            label: (node.detectorType ?? "").toLowerCase() || null,
            value: mode === "value" ? node.label : null,
          },
        });
        toast.success(t("correlation.exclude.done"));
        void waitForRecompute(since);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : t("correlation.exclude.failed"),
        );
      }
    },
    [t, waitForRecompute],
  );

  // ── Filter options ──────────────────────────────────────────────────────────
  const sourceOptions = React.useMemo(() => {
    const counts = new Map<string, number>();
    nodes.forEach((n) => {
      if (n.type === "asset" && n.sourceType)
        counts.set(n.sourceType, (counts.get(n.sourceType) ?? 0) + 1);
    });
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [nodes]);

  const labelOptions = React.useMemo(() => {
    const counts = new Map<string, number>();
    nodes.forEach((n) => {
      if (n.type === "finding" && n.detectorType)
        counts.set(n.detectorType, (counts.get(n.detectorType) ?? 0) + 1);
    });
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [nodes]);

  // Pairwise similarity lookup (0-1), keyed by sorted asset pair.
  const simByPair = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const s of similarities) {
      const k = pairKey(s.fromId, s.toId);
      m.set(k, Math.max(m.get(k) ?? 0, s.weighted));
    }
    return m;
  }, [similarities]);

  // ── Filters → similarity → search → collapse → drop isolated assets ─────────
  const {
    dNodes,
    dEdges,
    bundleDetails,
    visibleAssetIds,
    unconnectedCount,
    valueCount,
    externalAssetCount,
  } = React.useMemo(() => {
    const valueById = new Map(
      nodes.filter((n) => n.type === "finding").map((n) => [n.id, n]),
    );
    const assetById = new Map(
      nodes.filter((n) => n.type === "asset").map((n) => [n.id, n]),
    );

    // Pair-focus mode: short-circuit every other filter and show only the two
    // assets plus the shared-value nodes that connect them.
    if (focusPair) {
      const [a, b] = focusPair;
      const valuesOfA = new Set(
        edges.filter((e) => e.fromId === a && e.toType === "finding").map((e) => e.toId),
      );
      const valuesOfB = new Set(
        edges.filter((e) => e.fromId === b && e.toType === "finding").map((e) => e.toId),
      );
      const shared = [...valuesOfA].filter((v) => valuesOfB.has(v));
      const outNodes: GraphNodeDto[] = [];
      const nodeA = assetById.get(a);
      const nodeB = assetById.get(b);
      if (nodeA) outNodes.push(nodeA);
      if (nodeB) outNodes.push(nodeB);
      const outEdges: GraphEdgeDto[] = [];
      for (const vId of shared) {
        const vn = valueById.get(vId);
        if (vn) outNodes.push(vn);
        for (const e of edges) {
          if (e.toId === vId && (e.fromId === a || e.fromId === b)) outEdges.push(e);
        }
      }
      return {
        dNodes: outNodes,
        dEdges: outEdges,
        bundleDetails: new Map<string, BundleDetail>(),
        visibleAssetIds: [nodeA, nodeB].filter(Boolean).map((n) => n!.id),
        unconnectedCount: 0,
        valueCount: shared.length,
        externalAssetCount: 0,
      };
    }

    // 1) hard filters: source (assets), label (values), and (source-scoped)
    //    external assets unless "show external" is on.
    const srcSet = new Set(sourceFilter);
    const labelSet = new Set(labelFilter);
    const externalAssetCount = nodes.filter(
      (n) => n.type === "asset" && n.status === "external",
    ).length;
    const passAssets = new Set(
      nodes
        .filter(
          (n) =>
            n.type === "asset" &&
            (srcSet.size === 0 || (n.sourceType && srcSet.has(n.sourceType))) &&
            (showExternal || n.status !== "external"),
        )
        .map((n) => n.id),
    );
    let passValues = new Set(
      nodes
        .filter(
          (n) =>
            n.type === "finding" &&
            (labelSet.size === 0 ||
              (n.detectorType && labelSet.has(n.detectorType))),
        )
        .map((n) => n.id),
    );
    let activeEdges = edges.filter(
      (e) => passAssets.has(e.fromId) && passValues.has(e.toId),
    );

    // neighbours of each surviving value node (asset ids).
    const neighborsOf = (es: GraphEdgeDto[]) => {
      const m = new Map<string, string[]>();
      for (const e of es) (m.get(e.toId) ?? m.set(e.toId, []).get(e.toId)!).push(e.fromId);
      return m;
    };

    // 2) similarity slider: keep a value only if its strongest asset-pair meets
    //    the threshold (0 keeps everything).
    if (minSimilarity > 0) {
      const vn = neighborsOf(activeEdges);
      passValues = new Set(
        [...passValues].filter((vId) => {
          const ns = [...new Set(vn.get(vId) ?? [])];
          let best = 0;
          for (let i = 0; i < ns.length; i++)
            for (let j = i + 1; j < ns.length; j++)
              best = Math.max(best, simByPair.get(pairKey(ns[i]!, ns[j]!)) ?? 0);
          return best * 100 >= minSimilarity;
        }),
      );
      activeEdges = activeEdges.filter((e) => passValues.has(e.toId));
    }

    // 3) full-text search (case-insensitive) over asset names AND shared values:
    //    keep matches plus their 1-hop neighbours so a value match reveals its
    //    assets and an asset-name match reveals its shared values.
    const q = search.trim().toLowerCase();
    if (q) {
      const isMatch = (n?: GraphNodeDto) =>
        !!n &&
        [n.label, n.detectorType, n.sourceType, n.assetType]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      const matched = new Set<string>();
      for (const id of passAssets) if (isMatch(assetById.get(id))) matched.add(id);
      for (const id of passValues) if (isMatch(valueById.get(id))) matched.add(id);
      const keep = new Set(matched);
      for (const e of activeEdges) {
        if (matched.has(e.fromId)) keep.add(e.toId);
        if (matched.has(e.toId)) keep.add(e.fromId);
      }
      for (const id of [...passAssets]) if (!keep.has(id)) passAssets.delete(id);
      passValues = new Set([...passValues].filter((id) => keep.has(id)));
      activeEdges = activeEdges.filter(
        (e) => passAssets.has(e.fromId) && passValues.has(e.toId),
      );
    }

    // 4) collapse dense shared-value groups (by the exact asset-set they bind).
    const groups = new Map<string, string[]>();
    for (const [valueId, ns] of neighborsOf(activeEdges)) {
      const key = [...new Set(ns)].sort().join("|");
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(valueId);
    }

    const outNodes: GraphNodeDto[] = [...passAssets].map((id) => assetById.get(id)!);
    const outEdges: GraphEdgeDto[] = [];
    const details = new Map<string, BundleDetail>();

    for (const [key, valueIds] of groups) {
      const assetIds = key ? key.split("|") : [];
      // Strength of this asset-set = strongest pair within it (drives edge colour).
      let groupStrength = 0;
      for (let i = 0; i < assetIds.length; i++)
        for (let j = i + 1; j < assetIds.length; j++)
          groupStrength = Math.max(
            groupStrength,
            simByPair.get(pairKey(assetIds[i]!, assetIds[j]!)) ?? 0,
          );
      const collapse =
        valueIds.length > COLLAPSE_THRESHOLD && assetIds.length >= 2;
      if (!collapse) {
        const valueSet = new Set(valueIds);
        for (const vId of valueIds) {
          const vn = valueById.get(vId);
          if (vn) outNodes.push(vn);
        }
        for (const e of activeEdges) {
          if (valueSet.has(e.toId))
            outEdges.push({ ...e, confidence: groupStrength });
        }
        continue;
      }
      const pct =
        assetIds.length === 2 ? Math.round(groupStrength * 100) : undefined;
      const detail: BundleDetail = {
        assetIds,
        matchPercent: pct,
        values: valueIds
          .map((vId) => valueById.get(vId))
          .filter((v): v is GraphNodeDto => Boolean(v))
          .map((v) => ({ label: v.detectorType ?? "", value: v.label })),
      };
      const countLabel = t("correlation.fingerprints.sharedValuesN", {
        count: String(valueIds.length),
      });
      if (assetIds.length === 2) {
        const id = `${BUNDLE_EDGE_PREFIX}${key}`;
        outEdges.push({
          id,
          fromType: "asset",
          fromId: assetIds[0]!,
          toType: "asset",
          toId: assetIds[1]!,
          relationType: pct != null ? `${pct}% · ${countLabel}` : countLabel,
          confidence: groupStrength,
          origin: "MANUAL",
        });
        details.set(id, detail);
      } else {
        const nodeId = `${BUNDLE_NODE_PREFIX}${key}`;
        outNodes.push({
          id: nodeId,
          type: "finding",
          label: countLabel,
          depth: 1,
          detectorType: "BUNDLE",
        });
        for (const aId of assetIds) {
          outEdges.push({
            id: `${nodeId}->${aId}`,
            fromType: "asset",
            fromId: aId,
            toType: "finding",
            toId: nodeId,
            relationType: "shared",
            confidence: groupStrength,
            origin: "INFERRED",
          });
        }
        details.set(nodeId, detail);
      }
    }

    // 5) drop isolated assets (no incident edge) — surface the count instead.
    const connected = new Set<string>();
    for (const e of outEdges) {
      if (e.fromType === "asset") connected.add(e.fromId);
      if (e.toType === "asset") connected.add(e.toId);
    }
    const keptNodes = outNodes.filter(
      (n) => n.type !== "asset" || connected.has(n.id),
    );
    const unconnected = [...passAssets].filter((id) => !connected.has(id)).length;
    const values = keptNodes.filter((n) => n.type === "finding").length;

    return {
      dNodes: keptNodes,
      dEdges: outEdges,
      bundleDetails: details,
      visibleAssetIds: [...connected],
      unconnectedCount: unconnected,
      valueCount: values,
      externalAssetCount,
    };
  }, [
    nodes,
    edges,
    search,
    sourceFilter,
    labelFilter,
    minSimilarity,
    simByPair,
    showExternal,
    focusPair,
    t,
  ]);

  // ── Layout / viewport ──────────────────────────────────────────────────────
  const containerRef = React.useRef<HTMLDivElement>(null);
  const size = useContainerSize(containerRef);

  // ── Community clustering / semantic zoom ──────────────────────────────────
  // `useClusteredGraph` returns a fresh object literal on every call even
  // when its individually-memoized fields haven't changed; re-wrap it so
  // `clustered`'s identity is stable across no-op renders. Several
  // downstream callbacks (useClusterFocus, the lifted rail content) depend
  // on `clustered` directly — an unstable identity there previously caused
  // an effect→setState→render loop once the rail state started being
  // pushed to the host page.
  const clusteredUnstable = useClusteredGraph(dNodes, dEdges);
  const clustered = React.useMemo(
    () => clusteredUnstable,
    // Deliberately excluding `clusteredUnstable` itself: its wrapping object
    // literal is unstable every render even when every field below is
    // unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      clusteredUnstable.renderNodes,
      clusteredUnstable.renderEdges,
      clusteredUnstable.clusters,
      clusteredUnstable.clusterOfNode,
      clusteredUnstable.expandedClusters,
      clusteredUnstable.hasCollapsedClusters,
      clusteredUnstable.expandCluster,
      clusteredUnstable.collapseCluster,
      clusteredUnstable.collapseAll,
      clusteredUnstable.expandAllClusters,
    ],
  );
  const { renderNodes, renderEdges } = clustered;

  /** Fan seed positions for members of a just-expanded cluster. */
  const seedOverridesRef = React.useRef(new Map<string, { x: number; y: number }>());

  const layout = useForceLayout(renderNodes, renderEdges, size, seedOverridesRef.current);
  const panZoom = usePanZoom();

  const { expandCluster, focusCluster } = useClusterFocus({
    clustered,
    layout,
    panZoom,
    seedOverrides: seedOverridesRef.current,
    onBeforeExpand: clearFocus,
  });

  const [hoverKey, setHoverKey] = React.useState<string | null>(null);

  const zoomToFit = React.useCallback(() => {
    const bbox = nodesBBox(layout.simNodes.values());
    if (bbox) panZoom.fitBBox(bbox);
  }, [layout.simNodes, panZoom]);

  const didFit = React.useRef(false);
  const focusPairSignature = focusPair ? focusPair.join("|") : "";
  React.useEffect(() => {
    didFit.current = false;
  }, [assetId, focusPairSignature]);
  React.useEffect(() => {
    if (didFit.current || dNodes.length === 0) return;
    layout.onSettle(() => {
      didFit.current = true;
      zoomToFit();
    });
  }, [layout, zoomToFit, dNodes.length]);

  const nodeIndex = React.useMemo(() => {
    const m = new Map<string, GraphNodeDto>();
    renderNodes.forEach((n) => m.set(keyOf(n), n));
    return m;
  }, [renderNodes]);
  /** Raw (pre-clustering) nodes — cluster members are not in renderNodes. */
  const rawNodeByKey = React.useMemo(() => {
    const m = new Map<string, GraphNodeDto>();
    dNodes.forEach((n) => m.set(keyOf(n), n));
    return m;
  }, [dNodes]);
  const assetLabel = React.useCallback(
    (id: string) => nodes.find((n) => n.id === id)?.label ?? id,
    [nodes],
  );

  // A change in the underlying/filtered graph invalidates the focused path
  // (its node keys may no longer exist → would dim everything).
  React.useEffect(() => {
    clearFocus();
  }, [nodes, search, sourceFilter, labelFilter, minSimilarity, showExternal, focusPair, clearFocus]);

  // ── Click = focus this node's component (path); greyed nodes are inert ───────
  const onNodeClick = React.useCallback(
    (node: GraphNodeDto) => {
      const key = keyOf(node);
      if (path && !path.nodeKeys.has(key)) return; // dimmed → non-clickable
      setPath(focusComponent(key, renderEdges));
      setSelection({ type: "node", key });
    },
    [path, renderEdges],
  );
  const onEdgeClick = React.useCallback(
    (edge: GraphEdgeDto) => {
      if (path && !path.edgeIds.has(edge.id)) return;
      setPath(focusComponent(nodeKey(edge.fromType, edge.fromId), renderEdges));
      setSelection({ type: "edge", id: edge.id });
    },
    [path, renderEdges],
  );
  const onBackgroundClick = React.useCallback(() => {
    clearFocus();
    if (focusPair) onExitFocusPair?.();
  }, [clearFocus, focusPair, onExitFocusPair]);

  // When a path is focused, case actions pull exactly its assets.
  const targetAssetIds = React.useMemo(() => {
    if (!path) return visibleAssetIds;
    const ids: string[] = [];
    for (const key of path.nodeKeys) {
      if (key.startsWith("asset:")) ids.push(key.slice("asset:".length));
    }
    return ids;
  }, [path, visibleAssetIds]);

  const selectedNode =
    selection?.type === "node" ? (nodeIndex.get(selection.key) ?? null) : null;
  const selectedDetail: BundleDetail | null =
    selection?.type === "edge"
      ? (bundleDetails.get(selection.id) ?? null)
      : selectedNode
        ? (bundleDetails.get(selectedNode.id) ?? null)
        : null;

  const showEmpty = !loading && !error && dNodes.length === 0;

  // ── Similarity-heat visuals (was colorByStrength) ─────────────────────────
  // Finding/bundle nodes are tinted by the strongest similarity edge touching
  // them; edges carry their own heat color.
  const maxConfidenceByKey = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const e of renderEdges) {
      const c = Number(e.confidence ?? 0);
      for (const k of [nodeKey(e.fromType, e.fromId), nodeKey(e.toType, e.toId)]) {
        if (c > (m.get(k) ?? 0)) m.set(k, c);
      }
    }
    return m;
  }, [renderEdges]);

  const nodeDecorator = React.useCallback(
    (n: GraphNodeDto): NodeDecoration | null =>
      n.type === "finding"
        ? {
            fillOverride: strengthColor(maxConfidenceByKey.get(keyOf(n)) ?? 0),
            findingGlyph: "icon",
          }
        : null,
    [maxConfidenceByKey],
  );

  const edgeStyle = React.useCallback(
    (e: GraphEdgeDto): EdgeStyleOverride => ({
      stroke: strengthColor(Number(e.confidence ?? 0)),
      dash: [],
      // Meta (cluster↔cluster) edges keep their weight-scaled width.
      ...(isMetaEdge(e) ? {} : { width: 1.5 }),
      arrow: false,
    }),
    [],
  );

  const useInCase = React.useCallback(() => setCaseOpen(true), []);
  const rawNodeByKeyGetter = React.useCallback(
    (k: string) => rawNodeByKey.get(k),
    [rawNodeByKey],
  );

  // ── Rail content: rendered inline by default, lifted to the host page when
  //    `externalRail` is set (the workspace-style Fingerprints page). Memoized
  //    so its identity is stable across no-op renders — `externalRail` mode
  //    pushes this to the host page in an effect, and an unstable identity
  //    there would re-trigger that effect (and the host's setState) forever. ─
  const selectionRail = React.useMemo(
    () => (
      <FingerprintsGraphSelectionRail
        selection={selection}
        selectedNode={selectedNode}
        selectedDetail={selectedDetail}
        clustered={clustered}
        rawNodeByKey={rawNodeByKeyGetter}
        hoverKey={hoverKey}
        onHoverKey={setHoverKey}
        focusCluster={focusCluster}
        assetLabel={assetLabel}
        targetAssetIds={targetAssetIds}
        onClearFocus={clearFocus}
        onUseInCase={useInCase}
      />
    ),
    [
      selection,
      selectedNode,
      selectedDetail,
      clustered,
      rawNodeByKeyGetter,
      hoverKey,
      focusCluster,
      assetLabel,
      targetAssetIds,
      clearFocus,
      useInCase,
    ],
  );
  const overviewFooter = React.useMemo(
    () => (
      <FingerprintsGraphOverviewFooter
        clustered={clustered}
        focusCluster={focusCluster}
        hoverKey={hoverKey}
        onHoverKey={setHoverKey}
        visibleAssetIds={visibleAssetIds}
        unconnectedCount={unconnectedCount}
        valueCount={valueCount}
        onUseInCase={useInCase}
      />
    ),
    [clustered, focusCluster, hoverKey, visibleAssetIds, unconnectedCount, valueCount, useInCase],
  );

  // Push the rail snapshot up only when the selection itself changes — not
  // on `selectionRail`'s identity. `selectionRail` is memoized, but chasing
  // every transitive dependency (clustered/focusCluster/layout are also
  // consumed by the always-ticking force simulation) to guarantee its
  // reference never churns is fragile; gating on `selection` (a plain,
  // user-driven state value) is the one dependency guaranteed not to
  // change on its own, so this can never loop. The trade-off: sidebar-only
  // hover highlighting inside the selection panel may lag the canvas by
  // one selection cycle — the canvas itself is unaffected.
  React.useEffect(() => {
    if (!externalRail) return;
    onRailStateChange?.({ selection, selectionRail, onBack: clearFocus });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalRail, selection]);

  return (
    <div className="flex h-full flex-col border-2 border-border bg-card">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("correlation.fingerprints.search")}
            className="h-8 w-48 pl-7 text-sm"
          />
        </div>

        {sourceOptions.length > 0 && (
          <MultiSelect values={sourceFilter} onValuesChange={setSourceFilter}>
            <MultiSelectTrigger className="h-8 w-40 rounded-[2px] border-2 text-xs">
              <MultiSelectValue
                placeholder={t("correlation.fingerprints.filterSource")}
                overflowBehavior="cutoff"
              />
            </MultiSelectTrigger>
            <MultiSelectContent>
              <MultiSelectGroup>
                {sourceOptions.map((o) => (
                  <MultiSelectItem key={o.value} value={o.value}>
                    <span className="font-mono text-xs uppercase">{o.value}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">({o.count})</span>
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>
        )}

        {labelOptions.length > 0 && (
          <MultiSelect values={labelFilter} onValuesChange={setLabelFilter}>
            <MultiSelectTrigger className="h-8 w-40 rounded-[2px] border-2 text-xs">
              <MultiSelectValue
                placeholder={t("correlation.fingerprints.filterLabel")}
                overflowBehavior="cutoff"
              />
            </MultiSelectTrigger>
            <MultiSelectContent>
              <MultiSelectGroup>
                {labelOptions.map((o) => (
                  <MultiSelectItem key={o.value} value={o.value}>
                    <span className="text-xs">{o.value}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">({o.count})</span>
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>
        )}

        {similarities.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
              {t("correlation.fingerprints.minSimilarity", {
                count: String(minSimilarity),
              })}
            </span>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[minSimilarity]}
              onValueChange={(v) => setMinSimilarity(v[0] ?? 0)}
              className="w-28"
            />
          </div>
        )}

        {sourceId && externalAssetCount > 0 && (
          <Button
            variant={showExternal ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setShowExternal((v) => !v)}
          >
            <Globe className="mr-1.5 h-3.5 w-3.5" />
            {t("correlation.fingerprints.external", {
              count: String(externalAssetCount),
            })}
          </Button>
        )}

        {truncated && (
          <Badge variant="outline" className="text-[10px] uppercase">
            {t("correlation.fingerprints.truncated")}
          </Badge>
        )}

        <ClusterControls clustered={clustered} />

        <div className="ml-auto flex items-center gap-1">
          {externalRail && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={t("correlation.fingerprints.legend")}
                >
                  <Info className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="max-h-[70vh] w-80 space-y-4 overflow-y-auto">
                {overviewFooter}
              </PopoverContent>
            </Popover>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => (onTune ? onTune() : setTuneOpen(true))}
          >
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
            {t("correlation.fingerprints.tune")}
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={zoomToFit}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={load}>
            <RotateCw className="h-4 w-4" />
          </Button>
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
            nodeDecorator={nodeDecorator}
            edgeStyle={edgeStyle}
            hoverKey={hoverKey}
            onNodeHover={(n) => setHoverKey(n ? keyOf(n) : null)}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={(node) => {
              if (isClusterNode(node)) expandCluster(node.cluster);
            }}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeClick={onEdgeClick}
            onEdgeContextMenu={() => undefined}
            onBackgroundClick={onBackgroundClick}
          />
          {focusPair && (
            <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-[4px] border-2 border-foreground bg-background px-3 py-1.5 text-xs shadow-[3px_3px_0_#000]">
              <span className="font-mono font-semibold uppercase tracking-wide">
                {t("correlation.fingerprints.pairFocused")}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs"
                onClick={() => onExitFocusPair?.()}
              >
                <X className="mr-1 h-3 w-3" />
                {t("correlation.fingerprints.resetView")}
              </Button>
            </div>
          )}
          {(loading || recomputing || error || showEmpty) && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/80 backdrop-blur-sm">
              {recomputing ? (
                <Spinner size="lg" label={t("correlation.fingerprints.recomputing")} />
              ) : loading ? (
                <Spinner size="lg" label={t("correlation.fingerprints.title")} />
              ) : error ? (
                <EmptyState
                  icon={Fingerprint}
                  title={t("correlation.fingerprints.loadFailed")}
                  description={error}
                  action={{ label: t("correlation.fingerprints.retry"), onClick: load }}
                />
              ) : (
                <EmptyState
                  icon={Fingerprint}
                  title={t("correlation.fingerprints.empty")}
                  description={t("correlation.fingerprints.emptyDesc")}
                />
              )}
            </div>
          )}
        </div>

        {/* ── Detail / actions rail (self-contained embeds only) ── */}
        {!externalRail && (
          <aside className="w-[260px] shrink-0 space-y-4 overflow-y-auto border-l-2 border-border bg-background p-3">
            {selection ? selectionRail : overviewFooter}
          </aside>
        )}
      </div>

      {/* Right-click quick-exclude menu */}
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          />
          <div
            className="fixed z-50 w-60 overflow-hidden rounded-[4px] border-2 border-border bg-popover shadow-md"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <div className="truncate border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-mono uppercase">{ctxMenu.node.detectorType}</span>{" "}
              <span className="font-mono text-foreground">{ctxMenu.node.label}</span>
            </div>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => void exclude(ctxMenu.node, "value")}
            >
              <Ban className="h-3.5 w-3.5" />
              {t("correlation.exclude.value")}
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => void exclude(ctxMenu.node, "label")}
            >
              <Ban className="h-3.5 w-3.5" />
              {t("correlation.exclude.label", {
                label: (ctxMenu.node.detectorType ?? "").toLowerCase(),
              })}
            </button>
          </div>
        </>
      )}

      <CorrelationTuningDialog
        open={tuneOpen}
        onOpenChange={setTuneOpen}
        onSaved={() => void waitForRecompute(Date.now())}
      />
      {caseOpen && (
        <FingerprintsCaseDialog
          open={caseOpen}
          onOpenChange={setCaseOpen}
          assetIds={targetAssetIds}
        />
      )}
    </div>
  );
}
