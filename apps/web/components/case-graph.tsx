"use client";

import * as React from "react";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import CytoscapeComponent from "react-cytoscapejs";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import type { GraphEdgeDto, GraphNodeDto, HypothesisResponseDto } from "@workspace/api-client";

let registered = false;
if (!registered) {
  try { cytoscape.use(fcose as never); } catch { /* hot-reload */ }
  registered = true;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#b91c1c",
  HIGH:     "#c2410c",
  MEDIUM:   "#a16207",
  LOW:      "#1d4ed8",
  INFO:     "#78716c",
};

const HYP_NODE_ID = (id: string) => `hyp::${id}`;

/**
 * Stable fingerprint of the graph structure (hypothesis IDs + node IDs).
 * When this changes we re-run the fcose layout from scratch.
 */
function structureKey(
  hypotheses: HypothesisResponseDto[],
  visibleNodeKeys: string[],
): string {
  const hyps = hypotheses.map((h) => h.id).sort().join(",");
  const nds = [...visibleNodeKeys].sort().join(",");
  return `${hyps}|${nds}`;
}

/** fcose options — kept outside the component to be stable. */
const FCOSE_OPTIONS = {
  name: "fcose",
  quality: "proof",
  animate: true,
  animationDuration: 500,
  // Always randomize so new elements get proper initial positions.
  randomize: true,
  packComponents: false,
  nodeRepulsion: 7000,
  idealEdgeLength: 90,
  edgeElasticity: 0.45,
  // Compound-node gravity — keeps children firmly inside their hypothesis container.
  nestingFactor: 0.5,
  gravity: 0.25,
  gravityRange: 3.8,
  gravityCompound: 1.5,
  gravityRangeCompound: 2.0,
  numIter: 3000,
  tilingPaddingVertical: 20,
  tilingPaddingHorizontal: 20,
  // No relativePlacementConstraint: let physics pull hypothesis compounds
  // together naturally when they share cross-hypothesis assets between them.
} as const;

/** Pass `{ name: "preset" }` so CytoscapeComponent never auto-runs any layout.
 *  We manage the fcose layout ourselves via useEffect. */
const NULL_LAYOUT = { name: "preset" } as const;

interface ContextMenuState { x: number; y: number; node: GraphNodeDto; }

export interface CaseGraphProps {
  caseId: string;
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  hypotheses: HypothesisResponseDto[];
  hypothesisColors: Record<string, string>;
  evidenceKeys: Set<string>;
  /** nodeKey(type,id) → caseEvidenceId, for unlinking evidence */
  evidenceMap: Map<string, string>;
  selectedKey: string | null;
  onSelectNode: (node: GraphNodeDto | null) => void;
  onAddEdgeFrom?: (node: GraphNodeDto) => void;
  onRenameEdge?: (edge: GraphEdgeDto) => void;
  onDeleteEdge?: (edge: GraphEdgeDto) => void;
  onGraphChanged?: () => void;
}

const nodeKey = (type: string, id: string) => `${type}:${id}`;

export function CaseGraph({
  caseId,
  nodes,
  edges,
  hypotheses,
  hypothesisColors,
  evidenceKeys,
  evidenceMap,
  selectedKey,
  onSelectNode,
  onAddEdgeFrom,
  onRenameEdge,
  onDeleteEdge,
  onGraphChanged,
}: CaseGraphProps) {
  const [cy, setCy] = React.useState<cytoscape.Core | null>(null);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const [edgeContextMenu, setEdgeContextMenu] = React.useState<{
    x: number; y: number; edge: GraphEdgeDto;
  } | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  /**
   * Which assets have their UNLINKED findings currently shown (gray).
   * Linked findings (caseFindingId set) are always visible.
   */
  const [expandedAssets, setExpandedAssets] = React.useState<Set<string>>(new Set());

  // Per-asset linked / unlinked finding counts.
  const assetCounts = React.useMemo(() => {
    const linked = new Map<string, number>();
    const unlinked = new Map<string, number>();
    nodes.forEach((n) => {
      if (n.type === "finding" && n.assetId) {
        if (n.caseFindingId) linked.set(n.assetId, (linked.get(n.assetId) ?? 0) + 1);
        else unlinked.set(n.assetId, (unlinked.get(n.assetId) ?? 0) + 1);
      }
    });
    return { linked, unlinked };
  }, [nodes]);

  /** Nodes that actually appear in the graph. */
  const visibleNodes = React.useMemo(() =>
    nodes.filter((n) => {
      if (n.type !== "finding") return true;
      if (n.caseFindingId) return true; // linked → always shown
      return n.assetId ? expandedAssets.has(n.assetId) : false; // unlinked → only when expanded
    }),
    [nodes, expandedAssets],
  );

  const nodeIndex = React.useMemo(() => {
    const m = new Map<string, GraphNodeDto>();
    nodes.forEach((n) => m.set(nodeKey(n.type, n.id), n));
    return m;
  }, [nodes]);

  const edgeIndex = React.useMemo(() => {
    const m = new Map<string, GraphEdgeDto>();
    edges.forEach((e) => m.set(e.id, e));
    return m;
  }, [edges]);

  // ── Cytoscape elements ──────────────────────────────────────────────────

  const visibleKeys = React.useMemo(
    () => new Set(visibleNodes.map((n) => nodeKey(n.type, n.id))),
    [visibleNodes],
  );

  const elements = React.useMemo(() => {
    const els: object[] = [];

    // 1. Hypothesis compound parent nodes (always present, even when empty).
    hypotheses.forEach((h) => {
      const color = hypothesisColors[h.id] ?? "#888888";
      els.push({
        data: {
          id: HYP_NODE_ID(h.id),
          label: h.statement.length > 44 ? h.statement.slice(0, 42) + "…" : h.statement,
          kind: "hypothesis",
          hypColor: color,
        },
      });
    });

    // 2. Asset / finding nodes.
    visibleNodes.forEach((n) => {
      const key = nodeKey(n.type, n.id);
      const hypIds = n.hypothesisIds ?? [];

      // Single-hypothesis → place inside that compound.
      // Multi-hypothesis  → float between compounds (no parent); edges pull it to the boundary.
      // Un-affiliated     → also float (no parent).
      const parent = hypIds.length === 1 ? HYP_NODE_ID(hypIds[0]!) : undefined;

      const isLinked = n.type !== "finding" || !!n.caseFindingId;

      let label = n.label;
      if (n.type === "asset") {
        const uc = assetCounts.unlinked.get(n.id) ?? 0;
        if (uc > 0) {
          label += expandedAssets.has(n.id)
            ? `\n(+${uc} unlinked shown)`
            : `\n(+${uc} unlinked — click to show)`;
        }
      }

      els.push({
        data: {
          id: key,
          label,
          kind: n.type,
          severity: n.severity ?? "",
          isEvidence: evidenceKeys.has(key) ? "yes" : "no",
          linked: isLinked ? "yes" : "no",
          ...(parent ? { parent } : {}),
        },
      });
    });

    // 3. Edges between visible nodes only.
    edges.forEach((e) => {
      const src = nodeKey(e.fromType, e.fromId);
      const tgt = nodeKey(e.toType, e.toId);
      if (!visibleKeys.has(src) || !visibleKeys.has(tgt)) return;
      els.push({
        data: {
          id: e.id,
          source: src,
          target: tgt,
          label: e.relationType,
          origin: e.origin,
          crossHyp: e.crossHypothesis ? "yes" : "no",
        },
      });
    });

    return els;
  }, [visibleNodes, visibleKeys, edges, hypotheses, hypothesisColors, evidenceKeys, assetCounts, expandedAssets]);

  // ── Layout: re-run fcose whenever the structure changes ────────────────
  //
  // CytoscapeComponent uses layout={{ name: "preset" }} (no auto-layout).
  // We compute a stable "structure key" from hypothesis IDs + visible node IDs.
  // When it changes (new hypothesis, evidence added/removed, finding linked/unlinked)
  // we call cy.layout(FCOSE_OPTIONS).run() so the graph re-lays-out from scratch.

  const layoutStructureKey = React.useMemo(
    () => structureKey(hypotheses, Array.from(visibleKeys)),
    [hypotheses, visibleKeys],
  );

  React.useEffect(() => {
    if (!cy || elements.length === 0) return;
    // Wait one tick so CytoscapeComponent has finished reconciling elements.
    const id = setTimeout(() => {
      const l = cy.layout(FCOSE_OPTIONS as never);
      l.run();
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cy, layoutStructureKey]); // intentionally NOT including `elements` — only structural changes

  // ── Event listeners ─────────────────────────────────────────────────────

  React.useEffect(() => {
    if (!cy) return;
    cy.removeAllListeners();

    cy.on("tap", "node", (evt) => {
      const id = evt.target.id() as string;
      if (id.startsWith("hyp::")) { onSelectNode(null); return; }
      const node = nodeIndex.get(id);
      if (!node) return;
      // Clicking an asset with hidden unlinked findings toggles them.
      if (node.type === "asset" && (assetCounts.unlinked.get(node.id) ?? 0) > 0) {
        setExpandedAssets((prev) => {
          const next = new Set(prev);
          next.has(node.id) ? next.delete(node.id) : next.add(node.id);
          return next;
        });
      }
      onSelectNode(node);
      setContextMenu(null);
      setEdgeContextMenu(null);
    });

    cy.on("cxttap", "node", (evt) => {
      const id = evt.target.id() as string;
      if (id.startsWith("hyp::")) return;
      const node = nodeIndex.get(id);
      if (!node) return;
      const pos = evt.renderedPosition as { x: number; y: number };
      const rect = cy.container()?.getBoundingClientRect() ?? { left: 0, top: 0 };
      setContextMenu({ x: rect.left + pos.x, y: rect.top + pos.y, node });
      setEdgeContextMenu(null);
    });

    cy.on("cxttap", "edge", (evt) => {
      const id = evt.target.id() as string;
      const edge = edgeIndex.get(id);
      if (!edge) return;
      const pos = evt.renderedPosition as { x: number; y: number };
      const rect = cy.container()?.getBoundingClientRect() ?? { left: 0, top: 0 };
      setEdgeContextMenu({ x: rect.left + pos.x, y: rect.top + pos.y, edge });
      setContextMenu(null);
    });

    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        onSelectNode(null);
        setContextMenu(null);
        setEdgeContextMenu(null);
      }
    });

    return () => { cy.removeAllListeners(); };
  }, [cy, nodeIndex, edgeIndex, onSelectNode, assetCounts]);

  // Sync Cytoscape selection with selectedKey.
  React.useEffect(() => {
    if (!cy) return;
    cy.$("node:selected").unselect();
    if (selectedKey) cy.getElementById(selectedKey).select();
  }, [cy, selectedKey]);

  // ── Stylesheet ──────────────────────────────────────────────────────────

  const stylesheet = React.useMemo(() => [
    // Compound hypothesis containers.
    {
      selector: 'node[kind = "hypothesis"]',
      style: {
        label: "data(label)",
        "font-size": "10px",
        "font-weight": "600",
        color: "#0a0a0a",
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": -8,
        "text-wrap": "wrap",
        "text-max-width": "200px",
        "background-color": "data(hypColor)",
        "background-opacity": 0.07,
        "border-color": "data(hypColor)",
        "border-width": 2,
        "border-style": "solid",
        "border-opacity": 0.7,
        // Generous padding keeps children well inside the boundary.
        padding: "48px",
        shape: "round-rectangle",
        "min-width": "120px",
        "min-height": "80px",
      },
    },
    // Base non-compound node.
    {
      selector: 'node[kind != "hypothesis"]',
      style: {
        label: "data(label)",
        "font-size": "9px",
        "text-wrap": "wrap",
        "text-max-width": "130px",
        "text-valign": "bottom",
        "text-margin-y": 4,
        color: "#0a0a0a",
        "background-color": "#0a0a0a",
        width: 26,
        height: 26,
        "border-width": 2,
        "border-color": "#0a0a0a",
      },
    },
    // Asset.
    {
      selector: 'node[kind = "asset"]',
      style: { "background-color": "#0a0a0a", shape: "round-rectangle" },
    },
    // Sandbox scan evidence — distinct diamond so it reads as a non-catalog source.
    {
      selector: 'node[kind = "sandbox"]',
      style: { "background-color": "#0a0a0a", shape: "diamond", width: 30, height: 30 },
    },
    // Linked finding (coloured by severity).
    {
      selector: 'node[kind = "finding"][linked = "yes"]',
      style: { shape: "ellipse", "background-color": "#78716c" },
    },
    // Unlinked finding — gray + semi-transparent.
    {
      selector: 'node[kind = "finding"][linked = "no"]',
      style: {
        shape: "ellipse",
        "background-color": "#d1d5db",
        "border-color": "#d1d5db",
        color: "#9ca3af",
        opacity: 0.65,
      },
    },
    ...Object.entries(SEVERITY_COLORS).map(([sev, color]) => ({
      selector: `node[kind = "finding"][linked = "yes"][severity = "${sev}"]`,
      style: { "background-color": color, "border-color": color },
    })),
    // Evidence highlight.
    {
      selector: 'node[isEvidence = "yes"]',
      style: { "border-width": 5, "border-color": "#b7ff00", "border-style": "solid" },
    },
    { selector: "node:selected", style: { "border-color": "#b7ff00", "border-width": 6, "border-style": "solid" } },
    // Base edge.
    {
      selector: "edge",
      style: {
        label: "data(label)",
        "font-size": "8px",
        color: "#3a3a3a",
        width: 1.5,
        "line-color": "#9ca3af",
        "target-arrow-color": "#9ca3af",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        "text-rotation": "autorotate",
        "text-background-color": "#f5f5f5",
        "text-background-opacity": 1,
        "text-background-padding": "2px",
      },
    },
    { selector: 'edge[origin = "MANUAL"]', style: { "line-color": "#d97706", "target-arrow-color": "#d97706", "line-style": "dashed" } },
    { selector: 'edge[crossHyp = "yes"]', style: { "line-color": "#a855f7", "target-arrow-color": "#a855f7", "line-style": "dashed", width: 2.5 } },
  ], []);

  // ── Actions ──────────────────────────────────────────────────────────────

  const unlinkFinding = async (node: GraphNodeDto) => {
    if (!node.caseFindingId) { toast.error("Cannot unlink: no record ID"); return; }
    try {
      await api.cases.casesControllerRemoveFinding({ id: caseId, caseFindingId: node.caseFindingId });
      toast.success("Finding unlinked");
      onGraphChanged?.();
    } catch (err) { console.error(err); toast.error("Failed to unlink finding"); }
  };

  const unlinkAsset = async (node: GraphNodeDto) => {
    const evidenceId = evidenceMap.get(nodeKey(node.type, node.id));
    if (!evidenceId) { toast.error("Evidence record not found"); return; }
    try {
      await api.cases.casesControllerRemoveEvidence({ id: caseId, evidenceId });
      toast.success("Evidence unlinked from case");
      onGraphChanged?.();
    } catch (err) { console.error(err); toast.error("Failed to unlink asset"); }
  };

  const toggleUnlinked = (nodeId: string) =>
    setExpandedAssets((prev) => {
      const next = new Set(prev);
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
      return next;
    });

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="relative h-full w-full">
      <CytoscapeComponent
        elements={elements as never}
        className="h-full w-full"
        style={{ width: "100%", height: "100%" }}
        stylesheet={stylesheet as never}
        // ⚠ We use "preset" here so react-cytoscapejs never auto-runs a layout.
        // Layout is managed exclusively by the useEffect above.
        layout={NULL_LAYOUT as never}
        minZoom={0.12}
        maxZoom={3}
        wheelSensitivity={0.2}
        cy={(instance) => { setCy(instance); }}
      />

      {/* Node context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[210px] rounded-md border border-border bg-popover py-1 shadow-md text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border mb-1">
            {contextMenu.node.type} · {contextMenu.node.label.split("\n")[0]}
          </div>

          {/* Asset: show / hide unlinked findings */}
          {contextMenu.node.type === "asset" && (assetCounts.unlinked.get(contextMenu.node.id) ?? 0) > 0 && (
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-accent transition-colors"
              onClick={() => { toggleUnlinked(contextMenu.node.id); setContextMenu(null); }}
            >
              {expandedAssets.has(contextMenu.node.id)
                ? `Hide ${assetCounts.unlinked.get(contextMenu.node.id)} unlinked findings`
                : `Show ${assetCounts.unlinked.get(contextMenu.node.id)} unlinked findings`}
            </button>
          )}

          {/* Evidence (asset/sandbox): unlink from case */}
          {contextMenu.node.type !== "finding" &&
            evidenceMap.has(nodeKey(contextMenu.node.type, contextMenu.node.id)) && (
              <button
                className="w-full px-3 py-1.5 text-left hover:bg-accent transition-colors text-destructive"
                onClick={() => { void unlinkAsset(contextMenu.node); setContextMenu(null); }}
              >
                Unlink from case
              </button>
            )}

          {/* Finding: unlink (only linked findings have caseFindingId) */}
          {contextMenu.node.type === "finding" && contextMenu.node.caseFindingId && (
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-accent transition-colors text-destructive"
              onClick={() => { void unlinkFinding(contextMenu.node); setContextMenu(null); }}
            >
              Unlink finding from case
            </button>
          )}

          {/* Add manual edge */}
          {onAddEdgeFrom && (
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-accent transition-colors"
              onClick={() => { onAddEdgeFrom(contextMenu.node); setContextMenu(null); }}
            >
              Add manual edge from here…
            </button>
          )}
        </div>
      )}

      {/* Edge context menu */}
      {edgeContextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[200px] rounded-md border border-border bg-popover py-1 shadow-md text-sm"
          style={{ left: edgeContextMenu.x, top: edgeContextMenu.y }}
        >
          <div className="px-3 py-1.5 border-b border-border mb-1">
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground block">
              {edgeContextMenu.edge.origin.replace("_", " ")}
            </span>
            <span className="font-medium">{edgeContextMenu.edge.relationType}</span>
          </div>
          {edgeContextMenu.edge.origin === "INFERRED" ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Inferred edges are auto-generated. Create a manual edge instead.
            </div>
          ) : (
            <>
              {onRenameEdge && (
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-accent transition-colors"
                  onClick={() => { onRenameEdge(edgeContextMenu.edge); setEdgeContextMenu(null); }}
                >
                  Rename edge…
                </button>
              )}
              {onDeleteEdge && (
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-accent transition-colors text-destructive"
                  onClick={() => { onDeleteEdge(edgeContextMenu.edge); setEdgeContextMenu(null); }}
                >
                  Delete edge
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
