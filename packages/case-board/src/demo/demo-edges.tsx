"use client";

import * as React from "react";
import { useStore, type EdgeProps } from "@xyflow/react";
import { Lock } from "lucide-react";
import { ContainsLine, LinkLine, StanceLine, SystemLine, TraceLine } from "../components/lines";
import { useEdgeGeometry } from "../hooks/use-edge-geometry";
import { useLabelsVisible, useLod } from "../hooks/use-lod";
import { useDemo } from "./demo-context";
import type { DemoFlowEdge, DemoFlowNode } from "./scene";

/** The demo's edges: the board's own lines, fed from the scene. */

/** Where an edge ends: a finding's own node, or its asset while findings are folded at far zoom. */
function useEndpoint(id: string): string {
  const lod = useLod();
  const parent = useStore((s) => {
    const node = s.nodeLookup.get(id) as DemoFlowNode | undefined;
    return node?.data.node.type === "finding" ? (node.parentId ?? null) : null;
  });
  return lod === "chip" && parent ? parent : id;
}

/** Anchored geometry between the two endpoints as currently drawn. */
function useGeometry(source: string, target: string, bend?: number) {
  return useEdgeGeometry(useEndpoint(source), useEndpoint(target), bend);
}

/** A node's name, for the words on a hover card. */
function useNodeName(id: string): string {
  return useStore((s) => {
    const node = s.nodeLookup.get(id) as DemoFlowNode | undefined;
    const n = node?.data.node;
    if (!n) return "";
    if (n.type === "asset" || n.type === "finding") return n.label;
    if (n.type === "hypothesis") return n.statement;
    if (n.type === "note") return n.text.slice(0, 40);
    return n.title;
  });
}

export const DemoContainsEdge = React.memo(function DemoContainsEdge({ id, source, target, data }: EdgeProps<DemoFlowEdge>) {
  const labelsVisible = useLabelsVisible();
  const lod = useLod();
  const g = useEdgeGeometry(source, target, data?.bend);
  const e = data?.edge;
  if (!g || e?.type !== "contains" || lod === "chip") return null;
  return <ContainsLine id={id} g={g} text="contains" showText={labelsVisible} ghost={e.ghost} />;
});

export const DemoLinkEdge = React.memo(function DemoLinkEdge({ id, source, target, data, selected }: EdgeProps<DemoFlowEdge>) {
  const labelsVisible = useLabelsVisible();
  const { hoveredEdgeId } = useDemo();
  const g = useGeometry(source, target, data?.bend);
  const e = data?.edge;
  if (!g || e?.type !== "link") return null;
  const hovered = hoveredEdgeId === id;
  return (
    <LinkLine
      id={id}
      g={g}
      kind={e.kind}
      text={e.text}
      showText={labelsVisible || hovered || !!selected}
      confidence={e.confidence ?? 0.5}
      suspected={e.suspected}
      global={e.global}
      selected={selected}
      suspectedLabel="suspected"
      globalLabel="Shown in every case"
      card={hovered ? (e.global ? "Shown in every case" : "Drawn by you") : null}
    />
  );
});

const STANCE_WORDS = {
  SUPPORTS: "Supports",
  CONTRADICTS: "Contradicts",
  NEUTRAL: "Bears on, without taking a side:",
} as const;

export const DemoStanceEdge = React.memo(function DemoStanceEdge({ id, source, target, data, selected }: EdgeProps<DemoFlowEdge>) {
  const labelsVisible = useLabelsVisible();
  const { hoveredEdgeId } = useDemo();
  const hypothesis = useNodeName(source);
  const g = useGeometry(source, target, data?.bend);
  const e = data?.edge;
  if (!g || e?.type !== "stance") return null;
  return (
    <StanceLine
      id={id}
      g={g}
      stance={e.stance}
      labelsVisible={labelsVisible}
      selected={selected}
      card={
        hoveredEdgeId === id || selected ? (
          <>
            <span className="block truncate">
              {STANCE_WORDS[e.stance]} “{hypothesis}”
            </span>
            {e.weight !== undefined && (
              <span className="block font-mono text-[10px] text-muted-foreground">Confidence {e.weight.toFixed(2)}</span>
            )}
            {e.note && <span className="block text-[10px] text-muted-foreground">{e.note}</span>}
          </>
        ) : null
      }
    />
  );
});

export const DemoRelationEdge = React.memo(function DemoRelationEdge({ id, source, target, data, selected }: EdgeProps<DemoFlowEdge>) {
  const labelsVisible = useLabelsVisible();
  const { hoveredEdgeId } = useDemo();
  const from = useNodeName(source);
  const to = useNodeName(target);
  const g = useGeometry(source, target, data?.bend);
  const e = data?.edge;
  if (!g || e?.type !== "relation") return null;
  const kind = e.kind ?? "reference";
  const hovered = hoveredEdgeId === id;
  const count = e.count ?? 1;
  const describe =
    kind === "lineage"
      ? `Data flows from ${from} into ${to}`
      : kind === "duplicate"
        ? "The same content, found twice"
        : kind === "usage"
          ? "One uses the other"
          : "One refers to the other";
  return (
    <SystemLine
      id={id}
      g={g}
      relationType={e.relation}
      showText={labelsVisible || hovered || !!selected}
      identity={kind === "duplicate"}
      count={count}
      selected={selected}
      card={
        hovered ? (
          <>
            <span className="flex items-center gap-1">
              <Lock className="size-3 shrink-0" aria-label="Found by the platform: it cannot be deleted" />
              <span className="truncate">{describe}</span>
              {count > 1 && <span className="font-mono">×{count}</span>}
            </span>
            <span className="block text-[10px] text-muted-foreground">Found by the platform</span>
          </>
        ) : null
      }
    />
  );
});

export const DemoTraceEdge = React.memo(function DemoTraceEdge({ id, source, target, data }: EdgeProps<DemoFlowEdge>) {
  const labelsVisible = useLabelsVisible();
  const g = useGeometry(source, target, data?.bend);
  const e = data?.edge;
  if (!g || e?.type !== "trace") return null;
  return <TraceLine id={id} g={g} kind={e.kind} relationType={e.relation} showText={labelsVisible} />;
});

export const DEMO_EDGE_TYPES = {
  contains: DemoContainsEdge,
  link: DemoLinkEdge,
  stance: DemoStanceEdge,
  relation: DemoRelationEdge,
  trace: DemoTraceEdge,
};
