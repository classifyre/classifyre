"use client";

import * as React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  useInternalNode,
  useStore,
  type Edge,
  type EdgeProps,
  type InternalNode,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Plus } from "lucide-react";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { CONCEPT_SIZE, FRAME_TITLE_HEIGHT, type SchemeFrame } from "@/lib/meaning-map-layout";
import type { MapNode } from "@/lib/semantic-api";

export const FALLBACK_SCHEME_COLOR = "#94a3b8";

/** Below this zoom a card shows only its name, set larger. */
const NAME_ONLY_ZOOM = 0.72;

/** How a card or line stands against what is hovered or selected. */
export type Tone = "focus" | "neighbor" | "dim" | "normal";

export interface ConceptNodeData extends Record<string, unknown> {
  concept: MapNode;
  /** The biggest concept on the map: bars are drawn against it. */
  maxAssets: number;
  tone: Tone;
  /** Highlighted by the case overlay (SL5 B4). */
  inCase: boolean;
}
export type ConceptFlowNode = Node<ConceptNodeData, "concept">;

export interface SchemeNodeData extends Record<string, unknown> {
  frame: SchemeFrame;
  dim: boolean;
}
export type SchemeFlowNode = Node<SchemeNodeData, "scheme">;

export interface RegionNodeData extends Record<string, unknown> {
  name: string;
  color: string;
  dim: boolean;
}
export type RegionFlowNode = Node<RegionNodeData, "region">;

export type MeaningFlowNode = ConceptFlowNode | SchemeFlowNode | RegionFlowNode;

export interface LinkEdgeData extends Record<string, unknown> {
  kind: string;
  tone: Tone;
  /** Curved between frames on the taxonomy, straight on the network. */
  curved: boolean;
  /** 0–1: how strongly the two go together (co-occurrence lift). */
  weight: number;
  label: string | null;
}
export type LinkFlowEdge = Edge<LinkEdgeData, "link">;
export type TreeFlowEdge = Edge<{ tone: Tone }, "tree">;
export type MeaningFlowEdge = LinkFlowEdge | TreeFlowEdge;

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;

/** What the canvas can change, for the nodes that offer it. */
export interface MeaningMapActions {
  editable: boolean;
  /** Start a new concept, in this scheme. */
  addConcept: (schemeId: string | null) => void;
}

export const MeaningMapActionsContext = React.createContext<MeaningMapActions>({
  editable: false,
  addConcept: () => undefined,
});

/** Edges need handles to attach to; these are never seen or dragged. */
function HiddenHandles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!pointer-events-none !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!pointer-events-none !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0"
      />
    </>
  );
}

/**
 * A concept: scheme colour down the left edge, its name, how many assets are
 * about it, and a bar whose length is that evidence (square root, against the
 * biggest concept) and whose colours are the severity mix behind it.
 */
export const ConceptNode = React.memo(function ConceptNode({
  data,
  selected,
}: NodeProps<ConceptFlowNode>) {
  const { t } = useTranslation();
  const nameOnly = useStore((state) => state.transform[2] < NAME_ONLY_ZOOM);
  const { concept, maxAssets, tone, inCase } = data;
  const color = concept.scheme?.color ?? FALLBACK_SCHEME_COLOR;
  const share = Math.sqrt(concept.totalAssetCount / Math.max(1, maxAssets));
  const segments = React.useMemo(() => {
    const counts = concept.severityCounts ?? {};
    const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
    if (total === 0) return [{ color, share: 1 }];
    const ranked = SEVERITY_ORDER.filter((level) => (counts[level] ?? 0) > 0).map((level) => ({
      color: FINDING_SEVERITY_COLOR_BY_ENUM[level],
      share: (counts[level] ?? 0) / total,
    }));
    const rest = total - ranked.reduce((sum, s) => sum + s.share * total, 0);
    return rest > 0 ? [...ranked, { color, share: rest / total }] : ranked;
  }, [concept.severityCounts, color]);
  const flagged = (concept.severityCounts.CRITICAL ?? 0) + (concept.severityCounts.HIGH ?? 0);

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col justify-center gap-1 overflow-hidden rounded-[4px] border-2 bg-card pl-3.5 pr-2.5 text-card-foreground transition-[opacity,border-color,box-shadow] duration-150",
        selected || tone === "focus"
          ? "border-foreground shadow-[3px_3px_0_0_var(--foreground)]"
          : tone === "neighbor"
            ? "border-foreground/70"
            : "border-border/50",
        tone === "dim" && "opacity-25",
        concept.context && "border-dashed",
        inCase && "outline outline-2 outline-offset-2 outline-[var(--accent)]",
      )}
      style={{ width: CONCEPT_SIZE.width, height: CONCEPT_SIZE.height }}
      title={concept.definition ?? undefined}
      data-testid="meaning-concept"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[5px]" style={{ backgroundColor: color }} />
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "min-w-0 flex-1",
            nameOnly
              ? "line-clamp-2 text-[14px] font-bold leading-[1.12]"
              : "truncate text-[12px] font-semibold leading-tight",
            concept.context && "text-muted-foreground",
          )}
        >
          {concept.name}
        </span>
        {!nameOnly && concept.pendingProposals > 0 && (
          <span
            className="shrink-0 rounded-[2px] border border-amber-500/60 px-1 font-mono text-[9px] font-bold leading-[14px] text-amber-600 dark:text-amber-400"
            title={t("semanticMap.pending", { count: String(concept.pendingProposals) })}
          >
            {concept.pendingProposals}
          </span>
        )}
      </div>
      {!nameOnly && (
        <div className="flex items-center gap-2">
          <span className="w-[54px] shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {concept.totalAssetCount.toLocaleString()}
          </span>
          <span className="relative h-[5px] flex-1 overflow-hidden rounded-[1px] bg-muted">
            <span
              className="absolute inset-y-0 left-0 flex"
              style={{ width: concept.totalAssetCount === 0 ? 0 : `${Math.max(3, share * 100)}%` }}
            >
              {segments.map((segment, index) => (
                <span key={index} style={{ width: `${segment.share * 100}%`, backgroundColor: segment.color }} />
              ))}
            </span>
          </span>
          {flagged > 0 && (
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  (concept.severityCounts.CRITICAL ?? 0) > 0
                    ? FINDING_SEVERITY_COLOR_BY_ENUM.CRITICAL
                    : FINDING_SEVERITY_COLOR_BY_ENUM.HIGH,
              }}
            />
          )}
        </div>
      )}
      <HiddenHandles />
    </div>
  );
});

/** A scheme's frame: the glossary it belongs to, drawn like a board frame. */
export const SchemeNode = React.memo(function SchemeNode({ data }: NodeProps<SchemeFlowNode>) {
  const { t } = useTranslation();
  const { editable, addConcept } = React.useContext(MeaningMapActionsContext);
  const { frame, dim } = data;
  const add = (event: React.MouseEvent) => {
    event.stopPropagation();
    addConcept(frame.scheme?.id ?? null);
  };
  const color = frame.scheme?.color ?? FALLBACK_SCHEME_COLOR;
  return (
    <div
      className={cn(
        "h-full w-full cursor-zoom-in rounded-[6px] border-2 border-dashed border-border/40 bg-muted/20 transition-opacity",
        dim && "opacity-40",
      )}
      style={{ width: frame.width, height: frame.height }}
      data-testid="meaning-scheme"
    >
      <div
        className="flex items-center gap-2 px-2.5"
        style={{ height: FRAME_TITLE_HEIGHT - 4 }}
        title={t("semanticMap.conceptCount", { count: String(frame.conceptIds.length) })}
      >
        <span aria-hidden className="size-3 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
        <span className="line-clamp-2 min-w-0 flex-1 font-serif text-[12px] font-black uppercase leading-[1.1] tracking-[0.03em]">
          {frame.scheme?.name ?? t("semanticMap.noScheme")}
        </span>
        <span className="shrink-0 rounded-[2px] bg-muted px-1 font-mono text-[10px] tabular-nums text-muted-foreground">
          {frame.conceptIds.length}
        </span>
        {editable && (
          <button
            type="button"
            onClick={add}
            aria-label={t("semanticMap.edit.addInScheme", { scheme: frame.scheme?.name ?? t("semanticMap.noScheme") })}
            title={t("semanticMap.edit.addInScheme", { scheme: frame.scheme?.name ?? t("semanticMap.noScheme") })}
            className="nodrag nopan shrink-0 cursor-pointer rounded-[3px] border border-border p-0.5 hover:bg-muted"
            data-testid="meaning-scheme-add"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {editable && frame.conceptIds.length === 0 && (
        <div className="px-2.5">
          <button
            type="button"
            onClick={add}
            className="nodrag nopan flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[4px] border-2 border-dashed border-border/60 text-xs text-muted-foreground hover:border-border hover:text-foreground"
            style={{ height: CONCEPT_SIZE.height }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("semanticMap.edit.addFirst")}
          </button>
        </div>
      )}
    </div>
  );
});

/**
 * A scheme's name over its neighbourhood on the network, where there are no
 * frames to carry it.
 */
export const RegionNode = React.memo(function RegionNode({ data }: NodeProps<RegionFlowNode>) {
  return (
    <div
      className={cn(
        "pointer-events-none flex h-full w-full items-end justify-center pb-1 transition-opacity",
        data.dim ? "opacity-15" : "opacity-60",
      )}
    >
      <span className="flex items-center gap-2 whitespace-nowrap font-serif text-[20px] font-black uppercase tracking-[0.06em] text-muted-foreground">
        <span aria-hidden className="size-3 rounded-[2px]" style={{ backgroundColor: data.color }} />
        {data.name}
      </span>
    </div>
  );
});

function box(node: InternalNode) {
  const { x, y } = node.internals.positionAbsolute;
  const width = node.measured.width ?? CONCEPT_SIZE.width;
  const height = node.measured.height ?? CONCEPT_SIZE.height;
  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
}

/** Where the line from a box's centre towards a point leaves the box. */
function exitPoint(b: ReturnType<typeof box>, towards: { x: number; y: number }) {
  const dx = towards.x - b.cx;
  const dy = towards.y - b.cy;
  if (dx === 0 && dy === 0) return { x: b.cx, y: b.cy };
  const scale = Math.min(
    dx === 0 ? Infinity : b.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : b.height / 2 / Math.abs(dy),
  );
  return { x: b.cx + dx * scale, y: b.cy + dy * scale };
}

/**
 * The outline's elbow: down from under the broader concept, then across into
 * the narrower one.
 */
export function TreeEdge({ source, target, data }: EdgeProps<TreeFlowEdge>) {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  if (!from || !to) return null;
  const a = box(from);
  const b = box(to);
  const x = a.x + 9;
  const path = `M ${x} ${a.y + a.height} V ${b.cy - 6} Q ${x} ${b.cy} ${x + 6} ${b.cy} H ${b.x}`;
  const tone = data?.tone ?? "normal";
  return (
    <BaseEdge
      path={path}
      style={{
        stroke: tone === "focus" ? "var(--foreground)" : "var(--muted-foreground)",
        strokeWidth: tone === "focus" ? 2 : 1.5,
        opacity: tone === "dim" ? 0.15 : tone === "focus" ? 1 : 0.55,
      }}
    />
  );
}

const DASH: Record<string, string | undefined> = {
  BROADER: undefined,
  RELATED: "7 5",
  CO_OCCURRENCE: "1 5",
};

/**
 * Every other relation, from border to border: straight on the network,
 * bowed on the taxonomy so it does not run along the outline's lines.
 */
export function LinkEdge({ id, source, target, data }: EdgeProps<LinkFlowEdge>) {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  if (!from || !to || !data) return null;
  const a = box(from);
  const b = box(to);
  const start = exitPoint(a, { x: b.cx, y: b.cy });
  const end = exitPoint(b, { x: a.cx, y: a.cy });
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  let path = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  let labelAt = { x: midX, y: midY };
  if (data.curved) {
    const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const bow = Math.min(120, length * 0.18);
    const cx = midX - ((end.y - start.y) / length) * bow;
    const cy = midY + ((end.x - start.x) / length) * bow;
    path = `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`;
    labelAt = { x: (start.x + 2 * cx + end.x) / 4, y: (start.y + 2 * cy + end.y) / 4 };
  }
  const coOccurrence = data.kind === "CO_OCCURRENCE";
  const base = coOccurrence ? 0.45 : 0.6;
  const opacity = data.tone === "dim" ? 0.06 : data.tone === "focus" ? 1 : base;
  const width = (coOccurrence ? 1.5 + 2.5 * data.weight : 1.5) + (data.tone === "focus" ? 0.5 : 0);
  const showLabel = data.label && (data.tone === "focus" || !coOccurrence);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: data.tone === "focus" ? "var(--foreground)" : "var(--muted-foreground)",
          strokeWidth: width,
          strokeDasharray: DASH[data.kind] ?? "4 3",
          strokeLinecap: "round",
          opacity,
        }}
      />
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-[3px] border border-border bg-background px-1.5 py-px font-mono text-[10px] text-foreground"
            style={{ transform: `translate(-50%, -50%) translate(${labelAt.x}px, ${labelAt.y}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const MEANING_NODE_TYPES = { concept: ConceptNode, scheme: SchemeNode, region: RegionNode };
export const MEANING_EDGE_TYPES = { link: LinkEdge, tree: TreeEdge };
