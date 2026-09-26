import type { Edge, Node } from "@xyflow/react";
import type { LucideIcon } from "lucide-react";
import type { BoardColor } from "@workspace/schemas/case-board";
import { bendParallel } from "../lib/edges";
import {
  ASSET_ROUND,
  defaultFindingSpot,
  EVIDENCE_ROUND,
  FINDING_ROUND,
  HYPOTHESIS_PALETTE,
  SOURCE_PORT,
  TARGET_PORT,
  type FindingVisualState,
  type RoundShape,
  type SeverityKey,
} from "../lib/geometry";
import type { Stance, TraceKind } from "../lib/kinds";
import type { HypothesisStatus } from "../components/hypothesis-card";

/**
 * A board to show, written the way a person would describe it: assets and
 * their findings, hypotheses, notes and frames, and what joins them. Positions
 * are flow coordinates, like the board's own; a finding without one takes
 * its default spot around its asset, as it would on the board.
 */

interface DemoBase {
  id: string;
  x?: number;
  y?: number;
  /** Positions become relative to this node, and the node moves with it. */
  parent?: string;
}

export interface DemoAsset extends DemoBase {
  type: "asset";
  label: string;
  icon: LucideIcon;
  /** Where it came from, for the tooltip ("Mail archive"). */
  source?: string;
  /** In the case (the lime ring). Default true. */
  inCase?: boolean;
  /** A suggested neighbour: no ring, "+" to add it. */
  suggested?: boolean;
  /** Reached by "Show connections": dashed, with its hop badge. */
  trace?: { side: "up" | "down" | "side"; depth: number };
  /** Deleted at its source. */
  missing?: boolean;
  /** Findings folded away: the severity donut, and "▸n". */
  folded?: Array<{ severity: SeverityKey; count: number }>;
  /** "+n": findings of the asset that are not in the case. */
  more?: number;
  /** NEW: arrived since you last looked. */
  isNew?: boolean;
  highlight?: BoardColor;
}

export interface DemoFinding extends DemoBase {
  type: "finding";
  /** The asset it was found in. */
  parent: string;
  severity: SeverityKey;
  /** Detector name; the circle shows its initials. */
  detector: string;
  /** "Type: value" under the circle. */
  label: string;
  state?: FindingVisualState;
  /** False for a finding of the asset that is not in the case. Default true. */
  attached?: boolean;
  highlight?: BoardColor;
}

export interface DemoHypothesis extends DemoBase {
  type: "hypothesis";
  statement: string;
  status?: HypothesisStatus;
  confidence?: number | null;
  color?: string;
  entries?: number;
  lastEntry?: string;
  highlight?: BoardColor;
}

export interface DemoNote extends DemoBase {
  type: "note";
  text: string;
  color?: "yellow" | "blue" | "green" | "pink" | "gray";
  width?: number;
  height?: number;
  highlight?: BoardColor;
}

export interface DemoFrame extends DemoBase {
  type: "frame";
  title: string;
  tint?: "gray" | "yellow" | "blue" | "green" | "pink" | "violet";
  width: number;
  height: number;
  /** Shown as "n items" while collapsed. */
  collapsed?: number;
}

export type DemoNode = DemoAsset | DemoFinding | DemoHypothesis | DemoNote | DemoFrame;

export type DemoEdge =
  /** A link someone drew. */
  | { type: "link"; source: string; target: string; kind: string; text: string; suspected?: boolean; confidence?: number; global?: boolean }
  /** A hypothesis's stance on a piece of evidence (source is the hypothesis). */
  | { type: "stance"; source: string; target: string; stance: Stance; note?: string; weight?: number }
  /** A relation the platform found: lineage, a reference, a duplicate. */
  | { type: "relation"; source: string; target: string; relation: string; kind?: "lineage" | "reference" | "usage" | "duplicate"; count?: number }
  /** A relation "Show connections" found beyond the board. */
  | { type: "trace"; source: string; target: string; kind: TraceKind; relation: string };

export interface DemoScene {
  nodes: DemoNode[];
  edges?: DemoEdge[];
  /** Nodes that start selected. */
  selected?: string[];
  /** A hypothesis whose stances start in focus (everything else dims). */
  focus?: string;
  /** Nodes that start dimmed, as a spotlight or filter leaves them. */
  dim?: string[];
}

/** What each React Flow node carries: the demo node, plus what the scene derives. */
export type DemoNodeData = Record<string, unknown> & {
  node: DemoNode;
  round?: RoundShape;
  /** Hypothesis: "H1" and its colour; asset: the hypotheses citing it. */
  label?: string;
  color?: string;
  dots?: Array<{ id: string; color: string; title: string }>;
  counts?: { supports: number; contradicts: number; neutral: number };
  /** Asset: its findings per severity, for the ring it wears zoomed far out. */
  mix?: Array<{ severity: SeverityKey; count: number }>;
};

export type DemoEdgeData = Record<string, unknown> & {
  edge: DemoEdge | { type: "contains"; source: string; target: string; ghost: boolean };
  bend?: number;
};

export type DemoFlowNode = Node<DemoNodeData>;
export type DemoFlowEdge = Edge<DemoEdgeData>;

const TYPE_RANK: Record<DemoNode["type"], number> = { frame: 0, asset: 1, hypothesis: 1, note: 1, finding: 2 };
const SEVERITIES: readonly SeverityKey[] = ["critical", "high", "medium", "low", "info"];

/** The scene as React Flow nodes and edges, parents before their children. */
export function buildFlow(scene: DemoScene): { nodes: DemoFlowNode[]; edges: DemoFlowEdge[] } {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const depth = (n: DemoNode, seen = 0): number => {
    const parent = n.parent ? byId.get(n.parent) : undefined;
    return parent && seen < 8 ? depth(parent, seen + 1) + 1 : 0;
  };

  // H1, H2… in order, each with its palette colour unless it has its own.
  const hypotheses = new Map<string, { label: string; color: string; statement: string }>();
  for (const n of scene.nodes) {
    if (n.type !== "hypothesis") continue;
    const index = hypotheses.size;
    hypotheses.set(n.id, {
      label: `H${index + 1}`,
      color: n.color ?? HYPOTHESIS_PALETTE[index % HYPOTHESIS_PALETTE.length]!,
      statement: n.statement,
    });
  }

  // Stances give hypotheses their tallies and the evidence its dots.
  const counts = new Map<string, { supports: number; contradicts: number; neutral: number }>();
  const dots = new Map<string, Map<string, { id: string; color: string; title: string }>>();
  for (const e of scene.edges ?? []) {
    if (e.type !== "stance") continue;
    const tally = counts.get(e.source) ?? { supports: 0, contradicts: 0, neutral: 0 };
    if (e.stance === "SUPPORTS") tally.supports += 1;
    else if (e.stance === "CONTRADICTS") tally.contradicts += 1;
    else tally.neutral += 1;
    counts.set(e.source, tally);
    const target = byId.get(e.target);
    const assetId = target?.type === "finding" ? target.parent : target?.type === "asset" ? target.id : null;
    const meta = hypotheses.get(e.source);
    if (assetId && meta) {
      const set = dots.get(assetId) ?? new Map();
      set.set(e.source, { id: e.source, color: meta.color, title: `${meta.label} · ${meta.statement}` });
      dots.set(assetId, set);
    }
  }

  // Findings without a position take their default spot around the asset.
  const siblings = new Map<string, DemoFinding[]>();
  for (const n of scene.nodes) {
    if (n.type !== "finding") continue;
    siblings.set(n.parent, [...(siblings.get(n.parent) ?? []), n]);
  }
  const mixOf = (assetId: string) =>
    SEVERITIES.map((severity) => ({
      severity,
      count: (siblings.get(assetId) ?? []).filter((f) => f.attached !== false && f.severity === severity).length,
    })).filter((m) => m.count > 0);

  const selected = new Set(scene.selected ?? []);
  const nodes: DemoFlowNode[] = [...scene.nodes]
    .sort((a, b) => depth(a) - depth(b) || TYPE_RANK[a.type] - TYPE_RANK[b.type])
    .map((n) => {
      let position = { x: n.x ?? 0, y: n.y ?? 0 };
      if (n.type === "finding" && (n.x === undefined || n.y === undefined)) {
        const group = siblings.get(n.parent) ?? [n];
        position = defaultFindingSpot(group.indexOf(n), group.length);
      }
      const data: DemoNodeData = { node: n };
      if (n.type === "asset") {
        data.round = n.inCase === false || n.suggested || n.trace ? ASSET_ROUND : EVIDENCE_ROUND;
        data.dots = [...(dots.get(n.id)?.values() ?? [])];
        data.mix = mixOf(n.id);
      }
      if (n.type === "finding") data.round = FINDING_ROUND;
      if (n.type === "hypothesis") {
        const meta = hypotheses.get(n.id)!;
        data.label = meta.label;
        data.color = meta.color;
        data.counts = counts.get(n.id) ?? { supports: 0, contradicts: 0, neutral: 0 };
      }
      const flowNode: DemoFlowNode = {
        id: n.id,
        type: n.type,
        position,
        data,
        selected: selected.has(n.id),
        ...(n.parent && byId.has(n.parent) ? { parentId: n.parent } : {}),
      };
      if (n.type === "frame") {
        flowNode.style = { width: n.width, height: n.collapsed !== undefined ? 44 : n.height };
        flowNode.dragHandle = ".frame-drag";
        flowNode.selectable = true;
      }
      if (n.type === "note") flowNode.style = { width: n.width ?? 220, height: n.height ?? 140 };
      if (n.type === "hypothesis") flowNode.dragHandle = ".card-drag";
      return flowNode;
    });

  const edge = (id: string, type: string, source: string, target: string, data: DemoEdgeData): DemoFlowEdge => ({
    id,
    type,
    source,
    target,
    sourceHandle: SOURCE_PORT,
    targetHandle: TARGET_PORT,
    data,
  });

  const edges: DemoFlowEdge[] = [];
  for (const n of scene.nodes) {
    if (n.type !== "finding" || !byId.has(n.parent)) continue;
    const ghost = n.attached === false;
    edges.push(edge(`contains:${n.id}`, "contains", n.parent, n.id, { edge: { type: "contains", source: n.parent, target: n.id, ghost } }));
  }
  (scene.edges ?? []).forEach((e, i) => {
    if (!byId.has(e.source) || !byId.has(e.target)) return;
    edges.push(edge(`${e.type}:${i}`, e.type, e.source, e.target, { edge: e }));
  });

  return { nodes, edges: bendParallel(edges) };
}

/**
 * What dims, as on the board: a spotlight leaves only its kind lit; a
 * hypothesis in focus keeps itself and what its stances touch; a selection
 * keeps what it is joined to (frames stay, as context).
 */
export function dimmed(
  nodes: readonly Pick<DemoFlowNode, "id" | "type">[],
  edges: readonly Pick<DemoFlowEdge, "id" | "type" | "source" | "target">[],
  state: { dim?: readonly string[]; focus?: string | null; selected?: readonly string[] },
): { nodes: Set<string>; edges: Set<string> } {
  const out = { nodes: new Set<string>(), edges: new Set<string>() };
  const keepOnly = (keep: Set<string>) => {
    for (const n of nodes) if (!keep.has(n.id)) out.nodes.add(n.id);
    for (const e of edges) if (!(keep.has(e.source) && keep.has(e.target))) out.edges.add(e.id);
  };
  if (state.dim?.length) {
    const dim = new Set(state.dim);
    keepOnly(new Set(nodes.filter((n) => !dim.has(n.id)).map((n) => n.id)));
  } else if (state.focus && nodes.some((n) => n.id === state.focus)) {
    const keep = new Set([state.focus]);
    for (const e of edges) {
      if (e.type !== "stance") continue;
      if (e.source === state.focus) keep.add(e.target);
      if (e.target === state.focus) keep.add(e.source);
    }
    keepOnly(keep);
  } else if (state.selected?.length) {
    const keep = new Set(state.selected);
    for (const e of edges) {
      if (keep.has(e.source) || keep.has(e.target)) {
        keep.add(e.source);
        keep.add(e.target);
      }
    }
    for (const n of nodes) if (n.type === "frame") keep.add(n.id);
    keepOnly(keep);
  }
  return out;
}
