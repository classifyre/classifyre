"use client";

import * as React from "react";
import type { NodeProps } from "@xyflow/react";
import { AddButton, AssetNode, type NodeBadge } from "../components/asset-node";
import { FindingNodeView } from "../components/finding-node";
import { FrameView } from "../components/frame-node";
import { HypothesisCardView } from "../components/hypothesis-card";
import { NoteView } from "../components/note-node";
import { useLod } from "../hooks/use-lod";
import { findingCode } from "../lib/geometry";
import { useDemo } from "./demo-context";
import type { DemoFlowNode } from "./scene";

/**
 * The demo's nodes: the board's own views, fed from the scene instead of the
 * store. Nothing here is saved; "+" and the thread button only say what the
 * board would do.
 */

const SIDE_MARK = { up: "↑", down: "↓", side: "≈" } as const;
const SIDE_WORDS = { up: "upstream", down: "downstream", side: "alongside" } as const;
const STATE_WORDS = {
  open: null,
  new: "New in this case",
  resolved: "Resolved",
  dismissed: "Dismissed",
  gone: "Gone from its source",
  deleted: "Deleted",
} as const;
const SEVERITY_WORDS = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" } as const;

export const DemoAssetNode = React.memo(function DemoAssetNode({ data, selected }: NodeProps<DemoFlowNode>) {
  const lod = useLod();
  const demo = useDemo();
  const n = data.node;
  if (n.type !== "asset") return null;
  const outside = n.inCase === false || !!n.suggested || !!n.trace;
  // Zoomed far out, every asset folds its findings into their severity ring.
  const mix = n.folded ?? (lod === "chip" && data.mix?.length ? data.mix : undefined);
  const folded = mix?.reduce((sum, f) => sum + f.count, 0) ?? 0;
  const where = n.trace
    ? `${n.trace.depth} ${n.trace.depth === 1 ? "hop" : "hops"} ${SIDE_WORDS[n.trace.side]}`
    : n.suggested
      ? "Suggested neighbour: not in the case yet"
      : null;
  const topRight: NodeBadge | null = n.trace
    ? { text: `${SIDE_MARK[n.trace.side]}${n.trace.depth}`, title: where ?? "" }
    : n.more
      ? { text: `+${n.more}`, title: `${n.more} more findings on this asset, not in the case`, accent: true }
      : null;
  return (
    <AssetNode
      testId="demo-asset"
      label={n.label}
      title={[n.label, n.source, where, n.missing ? "Deleted at its source" : null].filter(Boolean).join(" · ")}
      Icon={n.icon}
      lod={lod}
      inCase={!outside}
      ghost={!!n.trace}
      selected={!!selected}
      missing={n.missing}
      highlight={n.highlight ?? null}
      donut={folded > 0 ? (mix ?? null) : null}
      topRight={lod === "chip" ? null : topRight}
      bottomRight={folded > 0 ? { text: `▸${folded}`, title: `${folded} findings folded away` } : null}
      topLeft={n.isNew ? { text: "NEW", title: "Arrived since you last looked", accent: true } : null}
      dots={data.dots}
      readOnly={false}
      linkable={!outside}
      action={
        outside && !n.missing && lod !== "chip" && (n.suggested || n.trace) ? (
          <AddButton
            placement={n.trace ? "side" : "top"}
            title="Add to the case"
            onClick={() => demo.say(`"${n.label}" would be added to the case right where it stands.`)}
          />
        ) : null
      }
    />
  );
});

export const DemoFindingNode = React.memo(function DemoFindingNode({ data, selected }: NodeProps<DemoFlowNode>) {
  const lod = useLod();
  const n = data.node;
  // Folded into its asset's ring at far zoom, as on the board.
  if (n.type !== "finding" || lod === "chip") return null;
  const attached = n.attached !== false;
  const state = n.state ?? "open";
  return (
    <FindingNodeView
      findingId={n.id}
      attached={attached}
      severity={n.severity}
      look={attached ? state : "ghost"}
      code={findingCode(n.detector, n.label)}
      label={n.label}
      title={[SEVERITY_WORDS[n.severity], n.label, n.detector, STATE_WORDS[state], attached ? null : "Not in the case"]
        .filter(Boolean)
        .join(" · ")}
      lod={lod}
      readOnly={false}
      selected={!!selected}
      highlight={n.highlight ?? null}
      newBadge={state === "new" && attached ? "NEW" : null}
      resolved={state === "resolved"}
      struck={state === "dismissed"}
    />
  );
});

const STATUS_WORDS = { PROPOSED: "Proposed", SUPPORTED: "Supported", REFUTED: "Refuted", INCONCLUSIVE: "Inconclusive" } as const;

export const DemoHypothesisNode = React.memo(function DemoHypothesisNode({ id, data, selected }: NodeProps<DemoFlowNode>) {
  const lod = useLod();
  const demo = useDemo();
  const n = data.node;
  if (n.type !== "hypothesis") return null;
  const status = n.status ?? "PROPOSED";
  return (
    <HypothesisCardView
      label={data.label ?? "H"}
      color={data.color ?? "#737373"}
      statement={n.statement}
      status={status}
      text={{
        status: STATUS_WORDS[status],
        confidence: "Confidence",
        supports: "Supports",
        contradicts: "Contradicts",
        neutral: "Neutral",
        openThread: "Open thread",
      }}
      lod={lod}
      readOnly={false}
      confidence={n.confidence ?? null}
      counts={data.counts ?? { supports: 0, contradicts: 0, neutral: 0 }}
      entries={n.entries ?? 0}
      lastEntry={n.lastEntry ?? null}
      selected={!!selected}
      focused={demo.focus === id}
      highlight={n.highlight ?? null}
      onToggleFocus={() => demo.setFocus(demo.focus === id ? null : id)}
      onOpenThread={() => demo.say("The thread opens in the side panel: the verdict, the evidence for and against, and the discussion.")}
    />
  );
});

export const DemoNoteNode = React.memo(function DemoNoteNode({ data, selected }: NodeProps<DemoFlowNode>) {
  const lod = useLod();
  const n = data.node;
  if (n.type !== "note") return null;
  return (
    <NoteView
      color={n.color ?? "yellow"}
      text={n.text}
      emptyLabel="Empty note"
      placeholder="Double-click to write…"
      lod={lod}
      readOnly={false}
      selected={!!selected}
      highlight={n.highlight ?? null}
    />
  );
});

export const DemoFrameNode = React.memo(function DemoFrameNode({ data, selected }: NodeProps<DemoFlowNode>) {
  const n = data.node;
  if (n.type !== "frame") return null;
  const collapsed = n.collapsed !== undefined;
  return (
    <FrameView
      tint={n.tint ?? "gray"}
      title={n.title}
      untitledLabel="Untitled frame"
      collapsed={collapsed}
      members={collapsed ? `${n.collapsed} items` : null}
      toggleLabel={collapsed ? "Expand" : "Collapse"}
      readOnly
      selected={!!selected}
    />
  );
});

export const DEMO_NODE_TYPES = {
  asset: DemoAssetNode,
  finding: DemoFindingNode,
  hypothesis: DemoHypothesisNode,
  note: DemoNoteNode,
  frame: DemoFrameNode,
};
