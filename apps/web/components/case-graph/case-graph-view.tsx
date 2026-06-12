"use client";

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
import { GraphCanvas } from "./graph-canvas";
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
import { useForceLayout } from "./use-force-layout";
import { usePanZoom } from "./use-pan-zoom";
import { nodesBBox, shortestPath } from "./graph-utils";
import {
  keyOf,
  nodeKey,
  type GraphMode,
  type GraphSelection,
  type PathResult,
} from "./graph-types";

export interface CaseGraphViewProps {
  caseId: string;
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  /** Hypothesis-kind threads of this case. */
  hypotheses: ThreadResponseDto[];
  hypothesisColors: Record<string, string>;
  evidence: CaseEvidenceDto[];
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
  onReload,
  onMergeExpansion,
}: CaseGraphViewProps) {
  const router = useRouter();

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

  /** Attached findings per asset — these are the collapsible ones. */
  const attachedByAsset = React.useMemo(() => {
    const m = new Map<string, number>();
    nodes.forEach((n) => {
      if (n.type === "finding" && n.caseFindingId && n.assetId) {
        m.set(n.assetId, (m.get(n.assetId) ?? 0) + 1);
      }
    });
    return m;
  }, [nodes]);

  // ── Findings collapse/expand (per asset, with a global default) ───────────

  const [findingsVisibleDefault, setFindingsVisibleDefault] = React.useState(true);
  const [expandOverrides, setExpandOverrides] = React.useState<Map<string, boolean>>(new Map());

  const isAssetExpanded = React.useCallback(
    (assetId: string) => expandOverrides.get(assetId) ?? findingsVisibleDefault,
    [expandOverrides, findingsVisibleDefault],
  );
  const toggleAssetExpanded = React.useCallback(
    (assetId: string) =>
      setExpandOverrides((prev) => {
        const next = new Map(prev);
        next.set(assetId, !(prev.get(assetId) ?? findingsVisibleDefault));
        return next;
      }),
    [findingsVisibleDefault],
  );
  const toggleFindingsDefault = React.useCallback(() => {
    setFindingsVisibleDefault((v) => !v);
    setExpandOverrides(new Map());
  }, []);

  const visibleNodes = React.useMemo(
    () =>
      nodes.filter((n) => {
        if (n.type !== "finding") return true;
        if (!n.caseFindingId) return false; // unattached → badge + dialog only
        return n.assetId ? isAssetExpanded(n.assetId) : true;
      }),
    [nodes, isAssetExpanded],
  );

  const visibleKeys = React.useMemo(
    () => new Set(visibleNodes.map(keyOf)),
    [visibleNodes],
  );

  /** Attached findings hidden because their asset is collapsed. */
  const collapsedCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    attachedByAsset.forEach((count, assetId) => {
      if (!isAssetExpanded(assetId)) m.set(assetId, count);
    });
    return m;
  }, [attachedByAsset, isAssetExpanded]);

  const [activeEdgeTypes, setActiveEdgeTypes] = React.useState<Set<string>>(new Set());

  const edgeTypes = React.useMemo(() => {
    const counts = new Map<string, number>();
    edges.forEach((e) => counts.set(e.relationType, (counts.get(e.relationType) ?? 0) + 1));
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type));
  }, [edges]);

  /**
   * Edges adjusted for visibility: an edge endpoint at a hidden finding
   * (collapsed asset or unattached) is re-routed to its parent asset so the
   * relationship stays observable; duplicates produced by the re-routing are
   * collapsed into one line. Self-loops (asset → its own finding) disappear.
   */
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
      if (activeEdgeTypes.size > 0 && !activeEdgeTypes.has(e.relationType)) continue;
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
  }, [edges, activeEdgeTypes, visibleKeys, nodeIndex]);

  const hypMemberCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    visibleNodes.forEach((n) =>
      (n.hypothesisIds ?? []).forEach((id) => m.set(id, (m.get(id) ?? 0) + 1)),
    );
    return m;
  }, [visibleNodes]);

  // ── Layout / viewport ─────────────────────────────────────────────────────

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 900, height: 600 });
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize((prev) =>
          Math.abs(prev.width - rect.width) > 1 || Math.abs(prev.height - rect.height) > 1
            ? { width: rect.width, height: rect.height }
            : prev,
        );
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const layout = useForceLayout(visibleNodes, visibleEdges, size);
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
    return s;
  }, [
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
      toast.success("Added to evidence");
      onReload();
    } catch (err) {
      console.error(err);
      toast.error("Failed to add evidence");
    }
  };

  const removeEvidence = async (node: GraphNodeDto) => {
    const evidenceId = evidenceMap.get(keyOf(node));
    if (!evidenceId) return;
    try {
      await api.cases.casesControllerRemoveEvidence({ id: caseId, evidenceId });
      toast.success("Removed from evidence");
      setSelection(null);
      onReload();
    } catch (err) {
      console.error(err);
      toast.error("Failed to remove evidence");
    }
  };

  const attachFinding = async (node: GraphNodeDto) => {
    try {
      await api.cases.casesControllerAttachFindings({
        id: caseId,
        attachFindingsDto: { findingIds: [node.id] },
      });
      toast.success("Finding attached to case");
      onReload();
    } catch (err) {
      console.error(err);
      toast.error("Failed to attach finding");
    }
  };

  const unlinkFinding = async (node: GraphNodeDto) => {
    if (!node.caseFindingId) return;
    try {
      await api.cases.casesControllerRemoveFinding({
        id: caseId,
        caseFindingId: node.caseFindingId,
      });
      toast.success("Finding unlinked");
      setSelection(null);
      onReload();
    } catch (err) {
      console.error(err);
      toast.error("Failed to unlink finding");
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
      toast.success(`Linked (${stance.toLowerCase()})`);
      onReload();
    } catch (err) {
      console.error(err);
      toast.error("Failed to link to hypothesis");
    }
  };

  const expandNode = async (node: GraphNodeDto) => {
    setExpandingKey(keyOf(node));
    try {
      const g = await api.graph.graphControllerExpand({
        expandGraphDto: { entityType: node.type, entityId: node.id, depth: 1, direction: "both" },
      });
      onMergeExpansion(g.nodes, g.edges);
      toast.success(`Expanded — ${g.nodes.length} nodes`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to expand");
    } finally {
      setExpandingKey(null);
    }
  };

  const deleteEdge = async (edge: GraphEdgeDto) => {
    try {
      await api.graph.graphControllerDeleteEdge({ id: edge.id });
      toast.success("Edge deleted");
      setSelection(null);
      onReload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(
        msg.includes("Inferred") ? "Inferred edges cannot be deleted." : "Failed to delete edge",
      );
    }
  };

  // ── Mode-aware node clicks ────────────────────────────────────────────────

  const computePath = (fromKey: string, toKey: string) => {
    const result = shortestPath(fromKey, toKey, visibleEdges);
    if (!result) {
      toast.info("No connection between these nodes in the current view");
      return;
    }
    setPath(result);
  };

  const handleNodeClick = (node: GraphNodeDto, shiftKey: boolean) => {
    const key = keyOf(node);
    setContextMenu(null);

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
        onAddEvidence={() => router.push(`/investigations/${caseId}/evidence/add`)}
        onNewHypothesis={() => setNewHypNode({ open: true, node: null })}
        onZoomToFit={zoomToFit}
        onReload={onReload}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        findingsVisible={findingsVisibleDefault}
        onToggleFindings={toggleFindingsDefault}
      />

      <div className="flex min-h-0 flex-1">
        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden">
          <GraphCanvas
            nodes={visibleNodes}
            edges={visibleEdges}
            layout={layout}
            panZoom={panZoom}
            evidenceKeys={evidenceKeys}
            hypothesisColors={hypothesisColors}
            attachableCounts={attachableCounts}
            collapsedCounts={collapsedCounts}
            selection={selection}
            mode={mode}
            activeNodeKeys={activeNodeKeys}
            path={path}
            onNodeClick={handleNodeClick}
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
            onAttachBadgeClick={(node) => setAttachAsset(node)}
            onToggleCollapse={(node) => toggleAssetExpanded(node.id)}
          />
        </div>

        <aside className="w-[300px] shrink-0 overflow-y-auto border-l-2 border-border bg-background p-3">
          {selectedNode ? (
            <NodeDetailPanel
              node={selectedNode}
              isEvidence={evidenceKeys.has(keyOf(selectedNode))}
              isPinned={layout.isPinned(keyOf(selectedNode))}
              attachableCount={attachableCountFor(selectedNode)}
              attachedCount={
                selectedNode.type === "asset" ? (attachedByAsset.get(selectedNode.id) ?? 0) : 0
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
              onToggleCollapse={() => toggleAssetExpanded(selectedNode.id)}
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
          attachedCount={(n) => (n.type === "asset" ? (attachedByAsset.get(n.id) ?? 0) : 0)}
          isAssetExpanded={(n) => isAssetExpanded(n.id)}
          onToggleCollapse={(n) => toggleAssetExpanded(n.id)}
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
              The manual relation “{edgeToDelete?.relationType}” is removed from the graph. The
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
