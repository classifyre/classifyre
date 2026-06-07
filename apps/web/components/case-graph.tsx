"use client";

import * as React from "react";
import cytoscape from "cytoscape";
import cola from "cytoscape-cola";
import dagre from "cytoscape-dagre";
import CytoscapeComponent from "react-cytoscapejs";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";

// Register layout extensions once.
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

export interface CaseGraphProps {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  evidenceKeys: Set<string>;
  onSelectNode: (node: GraphNodeDto | null) => void;
  selectedKey: string | null;
}

const nodeKey = (type: string, id: string) => `${type}:${id}`;

export function CaseGraph({
  nodes,
  edges,
  evidenceKeys,
  onSelectNode,
  selectedKey,
}: CaseGraphProps) {
  const nodeIndex = React.useMemo(() => {
    const m = new Map<string, GraphNodeDto>();
    nodes.forEach((n) => m.set(nodeKey(n.type, n.id), n));
    return m;
  }, [nodes]);

  const elements = React.useMemo(() => {
    const nodeEls = nodes.map((n) => {
      const key = nodeKey(n.type, n.id);
      return {
        data: {
          id: key,
          label: n.label,
          kind: n.type,
          severity: n.severity ?? "",
          isEvidence: evidenceKeys.has(key) ? "yes" : "no",
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
        },
      }));
    return [...nodeEls, ...edgeEls];
  }, [nodes, edges, evidenceKeys]);

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
      {
        selector: 'node[isEvidence = "yes"]',
        style: {
          "border-width": 4,
          "border-color": "#b7ff00",
        },
      },
      {
        selector: "node:selected",
        style: { "border-color": "#b7ff00", "border-width": 5 },
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
    ],
    [],
  );

  return (
    <CytoscapeComponent
      elements={elements as never}
      className="h-full w-full"
      style={{ width: "100%", height: "100%" }}
      stylesheet={stylesheet as never}
      layout={{ name: "cola", animate: true, maxSimulationTime: 1500 } as never}
      minZoom={0.2}
      maxZoom={2.5}
      wheelSensitivity={0.2}
      cy={(cy) => {
        cy.removeListener("tap");
        cy.on("tap", "node", (evt) => {
          const id = evt.target.id() as string;
          onSelectNode(nodeIndex.get(id) ?? null);
        });
        cy.on("tap", (evt) => {
          if (evt.target === cy) onSelectNode(null);
        });
        if (selectedKey) {
          cy.$("node:selected").unselect();
          const el = cy.getElementById(selectedKey);
          if (el) el.select();
        }
      }}
    />
  );
}
