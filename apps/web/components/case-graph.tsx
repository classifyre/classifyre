"use client";

import * as React from "react";
import cytoscape from "cytoscape";
import cola from "cytoscape-cola";
import dagre from "cytoscape-dagre";
import CytoscapeComponent from "react-cytoscapejs";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";

let registered = false;
if (!registered) {
  try {
    cytoscape.use(cola);
    cytoscape.use(dagre);
  } catch {
    // already registered (hot reload) — ignore
  }
  registered = true;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#b91c1c",
  HIGH: "#c2410c",
  MEDIUM: "#a16207",
  LOW: "#1d4ed8",
  INFO: "#78716c",
};

interface ContextMenu {
  x: number;
  y: number;
  node: GraphNodeDto;
}

export interface CaseGraphProps {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  evidenceKeys: Set<string>;
  /** hypothesisId → hex color string */
  hypothesisColors?: Record<string, string>;
  onSelectNode: (node: GraphNodeDto | null) => void;
  onAddEdgeFrom?: (node: GraphNodeDto) => void;
  onRenameEdge?: (edge: GraphEdgeDto) => void;
  onDeleteEdge?: (edge: GraphEdgeDto) => void;
  selectedKey: string | null;
}

const nodeKey = (type: string, id: string) => `${type}:${id}`;

export function CaseGraph({
  nodes,
  edges,
  evidenceKeys,
  hypothesisColors = {},
  onSelectNode,
  onAddEdgeFrom,
  onRenameEdge,
  onDeleteEdge,
  selectedKey,
}: CaseGraphProps) {
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

  // Hold the cy instance via useState so effects can depend on it.
  const [cy, setCy] = React.useState<cytoscape.Core | null>(null);

  const [contextMenu, setContextMenu] = React.useState<ContextMenu | null>(null);
  const [edgeContextMenu, setEdgeContextMenu] = React.useState<{
    x: number; y: number; edge: GraphEdgeDto;
  } | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close menus on outside click.
  React.useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
        setEdgeContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Bind / rebind Cytoscape event listeners whenever the cy instance or deps change.
  React.useEffect(() => {
    if (!cy) return;

    cy.removeAllListeners();

    cy.on("tap", "node", (evt) => {
      const id = evt.target.id() as string;
      onSelectNode(nodeIndex.get(id) ?? null);
      setContextMenu(null);
      setEdgeContextMenu(null);
    });

    cy.on("cxttap", "node", (evt) => {
      const id = evt.target.id() as string;
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

    return () => {
      cy.removeAllListeners();
    };
  }, [cy, nodeIndex, edgeIndex, onSelectNode]);

  // Sync selectedKey → Cytoscape selection without re-running listeners.
  React.useEffect(() => {
    if (!cy) return;
    cy.$("node:selected").unselect();
    if (selectedKey) {
      const el = cy.getElementById(selectedKey);
      if (el.length) el.select();
    }
  }, [cy, selectedKey]);

  const elements = React.useMemo(() => {
    const nodeEls = nodes.map((n) => {
      const key = nodeKey(n.type, n.id);
      const hypIds = n.hypothesisIds ?? [];
      // primary = first hypothesis color; multi = more than one
      const firstHypId = hypIds[0];
      const primaryHypColor = firstHypId ? (hypothesisColors[firstHypId] ?? "") : "";
      return {
        data: {
          id: key,
          label: n.label,
          kind: n.type,
          severity: n.severity ?? "",
          isEvidence: evidenceKeys.has(key) ? "yes" : "no",
          hypAffil: hypIds.length > 0 ? "yes" : "no",
          multiHyp: hypIds.length > 1 ? "yes" : "no",
          primaryHypColor,
        },
      };
    });
    const present = new Set(nodes.map((n) => nodeKey(n.type, n.id)));
    const edgeEls = edges
      .filter(
        (e) =>
          present.has(nodeKey(e.fromType, e.fromId)) &&
          present.has(nodeKey(e.toType, e.toId)),
      )
      .map((e) => ({
        data: {
          id: e.id,
          source: nodeKey(e.fromType, e.fromId),
          target: nodeKey(e.toType, e.toId),
          label: e.relationType,
          origin: e.origin,
          crossHyp: e.crossHypothesis ? "yes" : "no",
        },
      }));
    return [...nodeEls, ...edgeEls];
  }, [nodes, edges, evidenceKeys, hypothesisColors]);

  const stylesheet = React.useMemo(
    () => [
      {
        selector: "node",
        style: {
          label: "data(label)",
          "font-size": "9px",
          "text-wrap": "wrap",
          "text-max-width": "120px",
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
      {
        selector: 'node[kind = "asset"]',
        style: { "background-color": "#0a0a0a", shape: "round-rectangle" },
      },
      {
        selector: 'node[kind = "finding"]',
        style: { shape: "ellipse", "background-color": "#78716c" },
      },
      ...Object.entries(SEVERITY_COLORS).map(([sev, color]) => ({
        selector: `node[kind = "finding"][severity = "${sev}"]`,
        style: { "background-color": color, "border-color": color },
      })),
      // Hypothesis affiliation: colored border ring
      {
        selector: 'node[hypAffil = "yes"]',
        style: {
          "border-width": 4,
          "border-color": "data(primaryHypColor)",
        },
      },
      // Multi-hypothesis: dashed border to signal membership in several hypotheses
      {
        selector: 'node[multiHyp = "yes"]',
        style: {
          "border-width": 5,
          "border-style": "dashed",
        },
      },
      // Evidence ring overrides hypothesis ring (bright lime = in case)
      {
        selector: 'node[isEvidence = "yes"]',
        style: { "border-width": 5, "border-color": "#b7ff00", "border-style": "solid" },
      },
      {
        selector: "node:selected",
        style: { "border-color": "#b7ff00", "border-width": 6, "border-style": "solid" },
      },
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
      {
        selector: 'edge[origin = "MANUAL"]',
        style: {
          "line-color": "#d97706",
          "target-arrow-color": "#d97706",
          "line-style": "dashed",
        },
      },
      // Cross-hypothesis edge: purple, wider, dashed — shows lineage bridges
      {
        selector: 'edge[crossHyp = "yes"]',
        style: {
          "line-color": "#a855f7",
          "target-arrow-color": "#a855f7",
          "line-style": "dashed",
          width: 2.5,
        },
      },
    ],
    [],
  );

  return (
    <div className="relative h-full w-full">
      <CytoscapeComponent
        elements={elements as never}
        className="h-full w-full"
        style={{ width: "100%", height: "100%" }}
        stylesheet={stylesheet as never}
        layout={{ name: "cola", animate: true, maxSimulationTime: 1500 } as never}
        minZoom={0.2}
        maxZoom={2.5}
        wheelSensitivity={0.2}
        cy={(instance) => {
          // Store instance once; react-cytoscapejs calls this on mount.
          setCy(instance);
        }}
      />

      {/* Node context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover py-1 shadow-md text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border mb-1">
            {contextMenu.node.label}
          </div>
          {onAddEdgeFrom && (
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground transition-colors"
              onClick={() => {
                onAddEdgeFrom(contextMenu.node);
                setContextMenu(null);
              }}
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
              Inferred edges are auto-generated and cannot be modified.
              Create a manual edge with your own label instead.
            </div>
          ) : (
            <>
              {onRenameEdge && (
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground transition-colors"
                  onClick={() => {
                    onRenameEdge(edgeContextMenu.edge);
                    setEdgeContextMenu(null);
                  }}
                >
                  Rename edge…
                </button>
              )}
              {onDeleteEdge && (
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground transition-colors text-destructive"
                  onClick={() => {
                    onDeleteEdge(edgeContextMenu.edge);
                    setEdgeContextMenu(null);
                  }}
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
