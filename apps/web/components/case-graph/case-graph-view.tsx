"use client";

import { nsPath } from "@/lib/ns-path";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  api,
  LinkThreadSupportDtoStanceEnum,
  LinkThreadSupportDtoTargetTypeEnum,
  type CaseEvidenceDto,
  type GraphEdgeDto,
  type GraphNodeDto,
  type ThreadResponseDto,
} from "@workspace/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { ManualEdgeDialog } from "@/components/manual-edge-dialog";
import { RenameEdgeDialog } from "@/components/rename-edge-dialog";
import { GraphCanvas } from "../graph-explorer/graph-canvas";
import { GraphToolbar } from "./graph-toolbar";
import { GraphContextMenu, type ContextMenuState } from "./graph-context-menu";
import {
  EdgeTypeFilters,
  GraphLegendAndStats,
  HighlightFilters,
  HypothesisLegend,
  type HighlightOption,
} from "./graph-sidebar";
import { NodeDetailPanel } from "./node-detail-panel";
import { EdgeDetailPanel } from "./edge-detail-panel";
import { AttachFindingsDialog } from "./attach-findings-dialog";
import { NewHypothesisDialog } from "./new-hypothesis-dialog";
import { LinkHypothesisDialog, type LinkTarget } from "./link-hypothesis-dialog";
import { useForceLayout } from "../graph-explorer/use-force-layout";
import { usePanZoom } from "../graph-explorer/use-pan-zoom";
import { useContainerSize } from "../graph-explorer/use-container-size";
import { fanPositions, nodesBBox, shortestPath } from "../graph-explorer/graph-utils";
import { useVisibleGraph } from "../graph-explorer/use-visible-graph";
import {
  clusterNodeKey,
  isClusterNode,
  useClusteredGraph,
} from "../graph-explorer/use-clustered-graph";
import { ClusterControls } from "../graph-explorer/cluster-controls";
import { ClusterDetailPanel, ClusterOverviewPanel } from "../graph-explorer/cluster-panels";
import { useClusterFocus } from "../graph-explorer/use-cluster-focus";
import { severityArcsOf } from "../graph-explorer/node-render";
import {
  ACCENT,
  CROSS_HYP_COLOR,
  keyOf,
  nodeKey,
  type GraphMode,
  type GraphSelection,
  type PathResult,
} from "../graph-explorer/graph-types";
import type { NodeBadge, NodeDecoration } from "../graph-explorer/explorer-types";
import { useTranslation } from "@/hooks/use-translation";

export interface CaseGraphViewProps {
  caseId: string;
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  /** Hypothesis-kind threads of this case. */
  hypotheses: ThreadResponseDto[];
  hypothesisColors: Record<string, string>;
  evidence: CaseEvidenceDto[];
  /** Server hit its node cap — the graph shown is partial. */
  truncated?: boolean;
  onReload: () => void;
  onMergeExpansion: (nodes: GraphNodeDto[], edges: GraphEdgeDto[]) => void;
}

export function CaseGraphView({
  caseId,
  nodes,
  edges,
  hypotheses,
  hypothesisColors,
  evidence,
  truncated,
  onReload,
  onMergeExpansion,
}: CaseGraphViewProps) {
  const router = useRouter();
  const { t } = useTranslation();

  // ── Derived collections ───────────────────────────────────────────────────

  const evidenceKeys = React.useMemo(() => {
    const s = new Set<string>();
    evidence.forEach((e) => s.add(nodeKey(e.entityType, e.entityId)));
    return s;
  }, [evidence]);

  const evidenceMap = React.useMemo(() => {
    const m = new Map<string, string>();
    evidence.forEach((e) => m.set(nodeKey(e.entityType, e.entityId), e.id));
    return m;
  }, [evidence]);

  /** Findings on an asset that are not attached to the case (never rendered). */
  const attachableByAsset = React.useMemo(() => {
    const m = new Map<string, GraphNodeDto[]>();
    nodes.forEach((n) => {
      if (n.type === "finding" && !n.caseFindingId && n.assetId) {
        const arr = m.get(n.assetId) ?? [];
        arr.push(n);
        m.set(n.assetId, arr);
      }
    });
    return m;
  }, [nodes]);

  const attachableCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    attachableByAsset.forEach((arr, assetId) => m.set(assetId, arr.length));
    return m;
  }, [attachableByAsset]);

  const nodeIndex = React.useMemo(() => {
    const m = new Map<string, GraphNodeDto>();
    nodes.forEach((n) => m.set(keyOf(n), n));
    return m;
  }, [nodes]);

  // ── Findings collapse/expand (shared hook; collapsed by default) ──────────

  const [activeEdgeTypes, setActiveEdgeTypes] = React.useState<Set<string>>(new Set());

  const edgeTypes = React.useMemo(() => {
    const counts = new Map<string, number>();
    edges.forEach((e) => counts.set(e.relationType, (counts.get(e.relationType) ?? 0) + 1));
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type));
  }, [edges]);

  const filteredEdges = React.useMemo(
    () =>
      activeEdgeTypes.size > 0
        ? edges.filter((e) => activeEdgeTypes.has(e.relationType))
        : edges,
    [edges, activeEdgeTypes],
  );

  /** Unattached findings never render — they surface via the +n badge/dialog. */
  const hideUnattached = React.useCallback((n: GraphNodeDto) => !n.caseFindingId, []);

  const {
    visibleNodes,
    visibleEdges,
    collapsedCounts,
    assetStats,
    isAssetExpanded,
    toggleAssetExpanded,
    expandedDefault,
    toggleExpandedDefault,
  } = useVisibleGraph(nodes, filteredEdges, { hideFinding: hideUnattached });

  const hypMemberCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    visibleNodes.forEach((n) =>
      (n.hypothesisIds ?? []).forEach((id) => m.set(id, (m.get(id) ?? 0) + 1)),
    );
    return m;
  }, [visibleNodes]);

  // ── Layout / viewport ─────────────────────────────────────────────────────

  const containerRef = React.useRef<HTMLDivElement>(null);
  const size = useContainerSize(containerRef);

  /** Fan seed positions for findings of a just-expanded asset (consumed once). */
  const seedOverridesRef = React.useRef(new Map<string, { x: number; y: number }>());

  // ── Community clustering / semantic zoom ──────────────────────────────────
  const clustered = useClusteredGraph(visibleNodes, visibleEdges, { assetStats });
  const { renderNodes, renderEdges } = clustered;

  const layout = useForceLayout(renderNodes, renderEdges, size, seedOverridesRef.current);
  const panZoom = usePanZoom();

  const zoomToFit = React.useCallback(() => {
    const bbox = nodesBBox(layout.simNodes.values());
    if (bbox) panZoom.fitBBox(bbox);
  }, [layout.simNodes, panZoom]);

  const didInitialFit = React.useRef(false);
  React.useEffect(() => {
    if (didInitialFit.current) return;
    layout.onSettle(() => {
      didInitialFit.current = true;
      zoomToFit();
    });
  }, [layout, zoomToFit]);

  // ── Interaction state ─────────────────────────────────────────────────────

  const [mode, setMode] = React.useState<GraphMode>({ kind: "select" });
  const [selection, setSelection] = React.useState<GraphSelection>(null);
  const [path, setPath] = React.useState<PathResult | null>(null);
  const [hypothesisFocus, setHypothesisFocus] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [sourceFilter, setSourceFilter] = React.useState<string[]>([]);
  const [detectorFilter, setDetectorFilter] = React.useState<string[]>([]);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const [expandingKey, setExpandingKey] = React.useState<string | null>(null);

  // Dialog state
  const [edgeDialog, setEdgeDialog] = React.useState<{
    open: boolean;
    from: GraphNodeDto | null;
    to: GraphNodeDto | null;
  }>({ open: false, from: null, to: null });
  const [renameEdge, setRenameEdge] = React.useState<GraphEdgeDto | null>(null);
  const [edgeToDelete, setEdgeToDelete] = React.useState<GraphEdgeDto | null>(null);
  const [attachAsset, setAttachAsset] = React.useState<GraphNodeDto | null>(null);
  const [newHypNode, setNewHypNode] = React.useState<{ open: boolean; node: GraphNodeDto | null }>({
    open: false,
    node: null,
  });
  const [linkHypNode, setLinkHypNode] = React.useState<GraphNodeDto | null>(null);

  // Escape resets transient modes.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMode({ kind: "select" });
      setPath(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedNode =
    selection?.type === "node" ? (nodeIndex.get(selection.key) ?? null) : null;
  const selectedEdge =
    selection?.type === "edge" ? (edges.find((e) => e.id === selection.id) ?? null) : null;
  const selectedCluster =
    selection?.type === "node" && selection.key.startsWith("cluster:")
      ? (clustered.clusters.get(selection.key.slice("cluster:".length)) ?? null)
      : null;

  // ── Highlighting (dim non-matches; never remove) ──────────────────────────

  /** Stable filter value for a finding's category (custom detectors by name). */
  const detectorValueOf = React.useCallback((n: GraphNodeDto): string | null => {
    if (n.type !== "finding") return null;
    const custom = n.customDetectorName?.trim();
    if (n.detectorType?.toUpperCase() === "CUSTOM" && custom) return `custom:${custom}`;
    return n.detectorType ?? null;
  }, []);

  const sourceOfNode = React.useCallback(
    (n: GraphNodeDto): string | undefined =>
      n.sourceType ??
      (n.assetId ? nodeIndex.get(nodeKey("asset", n.assetId))?.sourceType : undefined),
    [nodeIndex],
  );

  const sourceOptions = React.useMemo<HighlightOption[]>(() => {
    const counts = new Map<string, number>();
    nodes.forEach((n) => {
      if (n.type === "finding") return;
      const src = n.sourceType;
      if (src) counts.set(src, (counts.get(src) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [nodes]);

  const detectorOptions = React.useMemo<HighlightOption[]>(() => {
    const counts = new Map<string, { label: string; count: number }>();
    nodes.forEach((n) => {
      if (n.type !== "finding" || !n.caseFindingId) return;
      const value = detectorValueOf(n);
      if (!value) return;
      const label = value.startsWith("custom:")
        ? value.slice(7)
        : value
            .toLowerCase()
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
      const prev = counts.get(value);
      counts.set(value, { label, count: (prev?.count ?? 0) + 1 });
    });
    return Array.from(counts.entries())
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [nodes, detectorValueOf]);

  const activeNodeKeys = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!hypothesisFocus && !query && sourceFilter.length === 0 && detectorFilter.length === 0) {
      return null;
    }
    const sourceSet = new Set(sourceFilter);
    const detectorSet = new Set(detectorFilter);

    // An asset matches a category filter when any of its attached findings do —
    // even while collapsed.
    const assetMatchesDetector = new Set<string>();
    if (detectorSet.size > 0) {
      nodes.forEach((n) => {
        if (n.type !== "finding" || !n.assetId) return;
        const v = detectorValueOf(n);
        if (v && detectorSet.has(v)) assetMatchesDetector.add(n.assetId);
      });
    }

    const matches = (n: GraphNodeDto): boolean => {
      if (hypothesisFocus && !(n.hypothesisIds ?? []).includes(hypothesisFocus)) return false;
      if (sourceSet.size > 0) {
        const src = sourceOfNode(n);
        if (!src || !sourceSet.has(src)) return false;
      }
      if (detectorSet.size > 0) {
        if (n.type === "finding") {
          const v = detectorValueOf(n);
          if (!v || !detectorSet.has(v)) return false;
        } else if (!assetMatchesDetector.has(n.id)) {
          return false;
        }
      }
      if (query) {
        const hay = [
          n.label,
          n.type,
          n.severity,
          n.detectorType,
          n.customDetectorName,
          n.sourceType,
          n.assetType,
          n.assetName,
          n.matchedContent,
          n.status,
          n.id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    };

    const s = new Set<string>();
    visibleNodes.forEach((n) => {
      if (matches(n)) s.add(keyOf(n));
    });
    // A collapsed cluster stays lit when any member matches.
    clustered.clusters.forEach((meta, cid) => {
      if (clustered.expandedClusters.has(cid)) return;
      if (meta.memberKeys.some((k) => s.has(k))) s.add(clusterNodeKey(cid));
    });
    return s;
  }, [
    clustered,
    hypothesisFocus,
    searchQuery,
    sourceFilter,
    detectorFilter,
    visibleNodes,
    nodes,
    detectorValueOf,
    sourceOfNode,
  ]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const addEvidence = async (node: GraphNodeDto) => {
    try {
      await api.cases.casesControllerAddEvidence({
        id: caseId,
        addEvidenceDto: { entityType: node.type, entityId: node.id },
      });
      toast.success(t("caseGraph.graphView.addedToEvidence"));
      onReload();
    } catch (err) {
      console.error(err);
      toast.error(t("caseGraph.graphView.failedToAddEvidence"));
    }
  };

  const removeEvidence = async (node: GraphNodeDto) => {
    const evidenceId = evidenceMap.get(keyOf(node));
    if (!evidenceId) return;
    try {
      await api.cases.casesControllerRemoveEvidence({ id: caseId, evidenceId });
      toast.success(t("caseGraph.graphView.removedFromEvidence"));
      setSelection(null);
      onReload();
    } catch (err) {
      console.error(err);
      toast.error(t("caseGraph.graphView.failedToRemoveEvidence"));
    }
  };

  const attachFinding = async (node: GraphNodeDto) => {
    try {
      await api.cases.casesControllerAttachFindings({
        id: caseId,
        attachFindingsDto: { findingIds: [node.id] },
      });
      toast.success(t("caseGraph.graphView.findingAttached"));
      onReload();
    } catch (err) {
      console.error(err);
      toast.error(t("caseGraph.graphView.failedToAttach"));
    }
  };

  const unlinkFinding = async (node: GraphNodeDto) => {
    if (!node.caseFindingId) return;
    try {
      await api.cases.casesControllerRemoveFinding({
        id: caseId,
        caseFindingId: node.caseFindingId,
      });
      toast.success(t("caseGraph.graphView.findingUnlinked"));
      setSelection(null);
      onReload();
    } catch (err) {
      console.error(err);
      toast.error(t("caseGraph.graphView.failedToUnlink"));
    }
  };

  /**
   * Hypothesis links point at case-scoped records (CaseEvidence.id /
   * CaseFinding.id), not raw entity ids — attach the node to the case first
   * when needed.
   */
  const resolveTarget = React.useCallback(
    async (node: GraphNodeDto): Promise<LinkTarget> => {
      if (node.type === "finding") {
        if (node.caseFindingId) {
          return {
            targetType: LinkThreadSupportDtoTargetTypeEnum.Finding,
            targetId: node.caseFindingId,
          };
        }
        await api.cases.casesControllerAttachFindings({
          id: caseId,
          attachFindingsDto: { findingIds: [node.id] },
        });
        const fresh = await api.cases.casesControllerFindOne({ id: caseId });
        const cf = (fresh.evidence ?? [])
          .flatMap((e) => e.findings ?? [])
          .find((f) => f.findingId === node.id);
        if (!cf) throw new Error("Finding was attached but could not be resolved");
        return { targetType: LinkThreadSupportDtoTargetTypeEnum.Finding, targetId: cf.id };
      }
      const existing = evidenceMap.get(keyOf(node));
      if (existing) {
        return { targetType: LinkThreadSupportDtoTargetTypeEnum.Evidence, targetId: existing };
      }
      const created = await api.cases.casesControllerAddEvidence({
        id: caseId,
        addEvidenceDto: { entityType: node.type, entityId: node.id },
      });
      return { targetType: LinkThreadSupportDtoTargetTypeEnum.Evidence, targetId: created.id };
    },
    [caseId, evidenceMap],
  );

  const quickLinkHypothesis = async (
    node: GraphNodeDto,
    threadId: string,
    stance: LinkThreadSupportDtoStanceEnum,
  ) => {
    try {
      const target = await resolveTarget(node);
      await api.threads.caseThreadsControllerLinkSupport({
        id: threadId,
        linkThreadSupportDto: { ...target, stance },
      });
      toast.success(t("caseGraph.graphView.linkedToHypothesis", { stance: stance.toLowerCase() }));
      onReload();
    } catch (err) {
      console.error(err);
      toast.error(t("caseGraph.graphView.failedToLink"));
    }
  };

  const expandNode = async (node: GraphNodeDto) => {
    setExpandingKey(keyOf(node));
    try {
      const g = await api.graph.graphControllerExpand({
        expandGraphDto: { entityType: node.type, entityId: node.id, depth: 1, direction: "both" },
      });
      onMergeExpansion(g.nodes, g.edges);
      toast.success(t("caseGraph.graphView.expanded", { count: String(g.nodes.length) }));
    } catch (err) {
      console.error(err);
      toast.error(t("caseGraph.graphView.failedToExpand"));
    } finally {
      setExpandingKey(null);
    }
  };

  const deleteEdge = async (edge: GraphEdgeDto) => {
    try {
      await api.graph.graphControllerDeleteEdge({ id: edge.id });
      toast.success(t("caseGraph.graphView.edgeDeleted"));
      setSelection(null);
      onReload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(
        msg.includes("Inferred") ? t("caseGraph.graphView.inferredCannotDelete") : t("caseGraph.graphView.failedToDeleteEdge"),
      );
    }
  };

  // ── Mode-aware node clicks ────────────────────────────────────────────────

  const computePath = (fromKey: string, toKey: string) => {
    const result = shortestPath(fromKey, toKey, renderEdges);
    if (!result) {
      toast.info(t("caseGraph.graphView.noPath"));
      return;
    }
    setPath(result);
  };

  const handleNodeClick = (node: GraphNodeDto, shiftKey: boolean) => {
    const key = keyOf(node);
    setContextMenu(null);

    // Editing actions target real entities — drill into the cluster first.
    if (isClusterNode(node) && mode.kind !== "select") {
      toast.info(t("graphExplorer.expandFirst"));
      return;
    }

    if (mode.kind === "connect") {
      if (!mode.sourceKey) {
        setMode({ kind: "connect", sourceKey: key });
      } else if (mode.sourceKey !== key) {
        const from = nodeIndex.get(mode.sourceKey);
        if (from) setEdgeDialog({ open: true, from, to: node });
        setMode({ kind: "connect", sourceKey: null });
      }
      return;
    }

    if (mode.kind === "path") {
      if (!mode.firstKey) {
        setMode({ kind: "path", firstKey: key });
      } else if (mode.firstKey !== key) {
        computePath(mode.firstKey, key);
        setMode({ kind: "select" });
      }
      return;
    }

    // select mode: shift-click finds a path from the current selection.
    if (shiftKey && selection?.type === "node" && selection.key !== key) {
      computePath(selection.key, key);
      return;
    }
    setPath(null);
    setSelection({ type: "node", key });
  };

  const handleBackgroundClick = () => {
    setContextMenu(null);
    if (mode.kind === "connect" && mode.sourceKey) {
      setMode({ kind: "connect", sourceKey: null });
      return;
    }
    if (mode.kind === "path" && mode.firstKey) {
      setMode({ kind: "path", firstKey: null });
      return;
    }
    setSelection(null);
    setPath(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const stats = React.useMemo(() => {
    let assetCount = 0;
    let findingCount = 0;
    visibleNodes.forEach((n) => {
      if (n.type === "finding") findingCount += 1;
      else assetCount += 1;
    });
    let manual = 0;
    edges.forEach((e) => {
      if (e.origin === "MANUAL") manual += 1;
    });
    let attachableTotal = 0;
    attachableCounts.forEach((c) => (attachableTotal += c));
    return {
      assetCount,
      findingCount,
      evidenceCount: evidence.length,
      manualEdgeCount: manual,
      inferredEdgeCount: edges.length - manual,
      attachableTotal,
    };
  }, [visibleNodes, edges, evidence, attachableCounts]);

  const attachableCountFor = (node: GraphNodeDto) =>
    node.type === "asset" ? (attachableCounts.get(node.id) ?? 0) : 0;

  /**
   * Expand/collapse an asset's findings. On expand, seed the findings as a
   * tidy fan around the asset's current position instead of random scatter.
   */
  const expandAssetWithFan = React.useCallback(
    (assetId: string) => {
      if (!isAssetExpanded(assetId)) {
        const center = layout.simNodes.get(nodeKey("asset", assetId));
        if (center) {
          const findingKeys = nodes
            .filter((n) => n.type === "finding" && n.caseFindingId && n.assetId === assetId)
            .map(keyOf);
          const positions = fanPositions(center, findingKeys.length);
          findingKeys.forEach((k, i) => seedOverridesRef.current.set(k, positions[i]!));
        }
      }
      toggleAssetExpanded(assetId);
    },
    [isAssetExpanded, toggleAssetExpanded, layout.simNodes, nodes],
  );

  const clearClusterFocus = React.useCallback(() => {
    setSelection(null);
    setPath(null);
  }, []);

  const { expandCluster, focusCluster } = useClusterFocus({
    clustered,
    layout,
    panZoom,
    seedOverrides: seedOverridesRef.current,
    onBeforeExpand: clearClusterFocus,
  });

  const [hoverKey, setHoverKey] = React.useState<string | null>(null);

  /** Case-specific node visuals: evidence ring, hypothesis dots, attach/collapse badges. */
  const nodeDecorator = React.useCallback(
    (n: GraphNodeDto): NodeDecoration | null => {
      const key = keyOf(n);
      const hypColors = (n.hypothesisIds ?? [])
        .map((id) => hypothesisColors[id])
        .filter((c): c is string => Boolean(c));
      const badges: NodeBadge[] = [];
      if (n.type === "asset") {
        const ac = attachableCounts.get(n.id) ?? 0;
        if (ac > 0) badges.push({ id: "attach", text: `+${ac}`, placement: "tr", accent: true });
        const cc = collapsedCounts.get(n.id) ?? 0;
        if (cc > 0) badges.push({ id: "collapse", text: `▸${cc}`, placement: "br" });
      }
      const deco: NodeDecoration = {};
      if (evidenceKeys.has(key)) deco.ringColor = ACCENT;
      if (hypColors.length > 1) deco.dashedRingColor = CROSS_HYP_COLOR;
      if (hypColors.length > 0) deco.dots = hypColors;
      if (badges.length > 0) deco.badges = badges;
      if (n.type === "asset" && !isAssetExpanded(n.id)) {
        const stats = assetStats.get(n.id);
        if (stats && stats.total > 0) deco.severityArcs = severityArcsOf(stats);
      }
      return Object.keys(deco).length > 0 ? deco : null;
    },
    [evidenceKeys, hypothesisColors, attachableCounts, collapsedCounts, assetStats, isAssetExpanded],
  );

  const handleBadgeClick = React.useCallback(
    (node: GraphNodeDto, badgeId: string) => {
      if (badgeId === "attach") setAttachAsset(node);
      else if (badgeId === "collapse") expandAssetWithFan(node.id);
    },
    [expandAssetWithFan],
  );

  return (
    <div className="flex h-full flex-col border-2 border-border bg-card">
      <GraphToolbar
        mode={mode}
        onModeChange={(m) => {
          setMode(m);
          setContextMenu(null);
        }}
        nodeCount={visibleNodes.length}
        edgeCount={visibleEdges.length}
        path={path}
        onClearPath={() => setPath(null)}
        onAddEvidence={() => router.push(nsPath(`/investigations/${caseId}/evidence/add`))}
        onNewHypothesis={() => setNewHypNode({ open: true, node: null })}
        onZoomToFit={zoomToFit}
        onReload={onReload}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        findingsVisible={expandedDefault}
        onToggleFindings={toggleExpandedDefault}
        extras={
          <>
            <ClusterControls clustered={clustered} />
            {truncated && (
              <span className="border-2 border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("graphExplorer.truncated")}
              </span>
            )}
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden">
          <GraphCanvas
            nodes={renderNodes}
            edges={renderEdges}
            layout={layout}
            panZoom={panZoom}
            nodeDecorator={nodeDecorator}
            selection={selection}
            mode={mode}
            activeNodeKeys={activeNodeKeys}
            path={path}
            onNodeClick={handleNodeClick}
            hoverKey={hoverKey}
            onNodeHover={(n) => setHoverKey(n ? keyOf(n) : null)}
            onNodeDoubleClick={(node) => {
              if (isClusterNode(node)) expandCluster(node.cluster);
              else if (node.type === "asset") expandAssetWithFan(node.id);
            }}
            onNodeContextMenu={(node, x, y) =>
              setContextMenu({ x, y, target: { kind: "node", node } })
            }
            onEdgeClick={(edge) => {
              setPath(null);
              setSelection({ type: "edge", id: edge.id });
            }}
            onEdgeContextMenu={(edge, x, y) =>
              setContextMenu({ x, y, target: { kind: "edge", edge } })
            }
            onBackgroundClick={handleBackgroundClick}
            onBadgeClick={handleBadgeClick}
          />
        </div>

        <aside className="w-[300px] shrink-0 overflow-y-auto border-l-2 border-border bg-background p-3">
          {selectedCluster ? (
            <ClusterDetailPanel
              meta={selectedCluster}
              clusters={clustered.clusters}
              renderEdges={renderEdges}
              nodeByKey={(k) => nodeIndex.get(k)}
              onFocusCluster={focusCluster}
              hoverKey={hoverKey}
              onHoverKey={setHoverKey}
            />
          ) : selectedNode ? (
            <NodeDetailPanel
              node={selectedNode}
              isEvidence={evidenceKeys.has(keyOf(selectedNode))}
              isPinned={layout.isPinned(keyOf(selectedNode))}
              attachableCount={attachableCountFor(selectedNode)}
              attachedCount={
                selectedNode.type === "asset" ? (assetStats.get(selectedNode.id)?.total ?? 0) : 0
              }
              isExpandedAsset={selectedNode.type === "asset" && isAssetExpanded(selectedNode.id)}
              hypotheses={hypotheses}
              hypothesisColors={hypothesisColors}
              expanding={expandingKey === keyOf(selectedNode)}
              onAddEvidence={() => void addEvidence(selectedNode)}
              onRemoveEvidence={() => void removeEvidence(selectedNode)}
              onAttachFinding={() => void attachFinding(selectedNode)}
              onUnlinkFinding={() => void unlinkFinding(selectedNode)}
              onLinkHypothesis={() => setLinkHypNode(selectedNode)}
              onConnectFrom={() => setMode({ kind: "connect", sourceKey: keyOf(selectedNode) })}
              onExpand={() => void expandNode(selectedNode)}
              onToggleCollapse={() => expandAssetWithFan(selectedNode.id)}
              onAttachFindingsDialog={() => setAttachAsset(selectedNode)}
              onReleasePin={() => layout.releasePin(keyOf(selectedNode))}
              onOpenAsset={() => window.open(`/assets/${selectedNode.id}`, "_blank")}
              onOpenFinding={() => window.open(`/findings/${selectedNode.id}`, "_blank")}
            />
          ) : selectedEdge ? (
            <EdgeDetailPanel
              edge={selectedEdge}
              fromNode={nodeIndex.get(nodeKey(selectedEdge.fromType, selectedEdge.fromId))}
              toNode={nodeIndex.get(nodeKey(selectedEdge.toType, selectedEdge.toId))}
              onSelectNode={(n) => setSelection({ type: "node", key: keyOf(n) })}
              onRename={() => setRenameEdge(selectedEdge)}
              onDelete={() => setEdgeToDelete(selectedEdge)}
            />
          ) : (
            <div className="space-y-6">
              {clustered.hasCollapsedClusters && (
                <ClusterOverviewPanel
                  clusters={clustered.clusters}
                  onFocusCluster={focusCluster}
                  hoverKey={hoverKey}
                  onHoverKey={setHoverKey}
                />
              )}
              <HypothesisLegend
                hypotheses={hypotheses}
                hypothesisColors={hypothesisColors}
                memberCounts={hypMemberCounts}
                focusId={hypothesisFocus}
                onToggleFocus={(id) =>
                  setHypothesisFocus((prev) => (prev === id ? null : id))
                }
                onNewHypothesis={() => setNewHypNode({ open: true, node: null })}
              />
              <HighlightFilters
                sourceOptions={sourceOptions}
                detectorOptions={detectorOptions}
                sourceFilter={sourceFilter}
                detectorFilter={detectorFilter}
                onSourceChange={setSourceFilter}
                onDetectorChange={setDetectorFilter}
              />
              <EdgeTypeFilters
                edgeTypes={edgeTypes}
                activeEdgeTypes={activeEdgeTypes}
                onToggle={(type) =>
                  setActiveEdgeTypes((prev) => {
                    const next = new Set(prev);
                    if (next.has(type)) next.delete(type);
                    else next.add(type);
                    return next;
                  })
                }
                onClear={() => setActiveEdgeTypes(new Set())}
              />
              <GraphLegendAndStats {...stats} />
            </div>
          )}
        </aside>
      </div>

      {/* ── Floating context menu ── */}
      {contextMenu && (
        <GraphContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          isEvidence={(n) => evidenceKeys.has(keyOf(n))}
          isPinned={(n) => layout.isPinned(keyOf(n))}
          attachableCount={attachableCountFor}
          attachedCount={(n) => (n.type === "asset" ? (assetStats.get(n.id)?.total ?? 0) : 0)}
          isAssetExpanded={(n) => isAssetExpanded(n.id)}
          onToggleCollapse={(n) => expandAssetWithFan(n.id)}
          hypotheses={hypotheses}
          hypothesisColors={hypothesisColors}
          onAddEvidence={(n) => void addEvidence(n)}
          onRemoveEvidence={(n) => void removeEvidence(n)}
          onAttachFinding={(n) => void attachFinding(n)}
          onUnlinkFinding={(n) => void unlinkFinding(n)}
          onQuickLinkHypothesis={(n, threadId, stance) =>
            void quickLinkHypothesis(n, threadId, stance)
          }
          onLinkHypothesisDialog={(n) => setLinkHypNode(n)}
          onNewHypothesis={(n) => setNewHypNode({ open: true, node: n })}
          onConnectFrom={(n) => setMode({ kind: "connect", sourceKey: keyOf(n) })}
          onPathFrom={(n) => setMode({ kind: "path", firstKey: keyOf(n) })}
          onExpand={(n) => void expandNode(n)}
          onAttachFindingsDialog={(n) => setAttachAsset(n)}
          onReleasePin={(n) => layout.releasePin(keyOf(n))}
          onOpenAsset={(n) => window.open(`/assets/${n.id}`, "_blank")}
          onOpenFinding={(n) => window.open(`/findings/${n.id}`, "_blank")}
          onRenameEdge={(e) => setRenameEdge(e)}
          onDeleteEdge={(e) => setEdgeToDelete(e)}
        />
      )}

      {/* ── Dialogs ── */}
      <ManualEdgeDialog
        open={edgeDialog.open}
        onOpenChange={(open) => setEdgeDialog((prev) => ({ ...prev, open }))}
        fromNode={edgeDialog.from}
        toNode={edgeDialog.to}
        nodes={visibleNodes}
        onCreated={onReload}
      />
      <RenameEdgeDialog
        open={renameEdge !== null}
        onOpenChange={(open) => !open && setRenameEdge(null)}
        edge={renameEdge}
        onRenamed={onReload}
      />
      <AttachFindingsDialog
        open={attachAsset !== null}
        onOpenChange={(open) => !open && setAttachAsset(null)}
        caseId={caseId}
        asset={attachAsset}
        findings={attachAsset ? (attachableByAsset.get(attachAsset.id) ?? []) : []}
        onAttached={onReload}
      />
      <NewHypothesisDialog
        open={newHypNode.open}
        onOpenChange={(open) => setNewHypNode((prev) => ({ ...prev, open }))}
        caseId={caseId}
        linkNodeLabel={newHypNode.node?.label ?? null}
        onCreated={(thread) => {
          const node = newHypNode.node;
          if (node) {
            void quickLinkHypothesis(node, thread.id, LinkThreadSupportDtoStanceEnum.Supports);
          } else {
            onReload();
          }
        }}
      />
      <LinkHypothesisDialog
        open={linkHypNode !== null}
        onOpenChange={(open) => !open && setLinkHypNode(null)}
        node={linkHypNode}
        hypotheses={hypotheses}
        hypothesisColors={hypothesisColors}
        resolveTarget={resolveTarget}
        onLinked={onReload}
      />
      <AlertDialog
        open={edgeToDelete !== null}
        onOpenChange={(open) => !open && setEdgeToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this edge?</AlertDialogTitle>
            <AlertDialogDescription>
              The manual relation "{edgeToDelete?.relationType}" is removed from the graph. The
              connected nodes are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (edgeToDelete) void deleteEdge(edgeToDelete);
                setEdgeToDelete(null);
              }}
            >
              Delete edge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
