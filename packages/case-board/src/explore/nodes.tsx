"use client";

import * as React from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { BookOpen, UserRound } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { AssetNode, type NodeBadge } from "../components/asset-node";
import { Ports } from "../components/ports";
import { useLod } from "../hooks/use-lod";
import type { RoundShape } from "../lib/geometry";
import { useExploreCanvas } from "./canvas-context";
import { TERM_CHIP } from "./layout";
import { EXPLORE_KIND_STROKE, type ExploreAsset, type ExploreTerm } from "./model";

export type ExploreNodeData =
  | { node: "asset"; asset: ExploreAsset; round: RoundShape }
  | { node: "term"; term: ExploreTerm; count: number; anchor?: boolean }
  | { node: "lane"; text: string };

export type ExploreFlowNode = Node<ExploreNodeData>;

const SIDE_MARK = { up: "↑", down: "↓" } as const;

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * An asset: the board's own asset node. The starting points wear the lime
 * ring; every other asset carries one dot per kind of connection that
 * reached it. Corner badges say which are already evidence in a case and
 * which answer a watch, and one from another source carries that source's
 * name; a double click dives into it.
 */
export const ExploreAssetNode = React.memo(function ExploreAssetNode({ data, selected }: NodeProps<ExploreFlowNode>) {
  const lod = useLod();
  const canvas = useExploreCanvas();
  if (data.node !== "asset") return null;
  const a = data.asset;
  const seed = a.side === "seed";
  const placed = a.side === "up" || a.side === "down";
  const where = placed ? canvas.words.where(a.side as "up" | "down", a.depth) : null;
  const cases = a.cases ?? [];
  const watches = a.watches ?? [];
  const chip = lod === "chip";
  const topRight: NodeBadge | null =
    placed && !chip ? { text: `${SIDE_MARK[a.side as "up" | "down"]}${a.depth}`, title: where ?? "" } : null;
  const topLeft: NodeBadge | null =
    cases.length && !chip
      ? {
          text: cases.length > 1 ? `${canvas.words.caseMark} ${cases.length}` : canvas.words.caseMark,
          title: `${canvas.words.inCase}: ${cases.join(", ")}`,
          accent: true,
        }
      : null;
  const bottomRight: NodeBadge | null =
    watches.length && !chip
      ? {
          text: watches.length > 1 ? `${canvas.words.watchMark} ${watches.length}` : canvas.words.watchMark,
          title: `${canvas.words.watched}: ${watches.join(", ")}`,
        }
      : null;
  const bottomLeft: NodeBadge | null =
    a.foreign && !a.external && !chip
      ? {
          text: shorten(a.sourceName ?? canvas.words.elsewhere, 14),
          title: `${canvas.words.elsewhere}: ${a.sourceName ?? ""}`,
        }
      : null;
  const kinds = a.kinds.map((k) => canvas.words.kinds[k]);
  return (
    <AssetNode
      testId="explore-asset"
      label={a.label}
      title={[a.label, a.sourceName, where, kinds.join(", "), seed || a.external ? null : canvas.words.walk]
        .filter(Boolean)
        .join(" · ")}
      Icon={canvas.iconFor(a.assetType)}
      lod={lod}
      inCase={seed}
      selected={!!selected}
      missing={false}
      ghost={!!a.external}
      dots={
        seed
          ? undefined
          : a.kinds.map((k) => ({ id: k, color: EXPLORE_KIND_STROKE[k], title: canvas.words.kinds[k] }))
      }
      topRight={topRight}
      topLeft={topLeft}
      bottomRight={bottomRight}
      bottomLeft={bottomLeft}
      readOnly={!canvas.canLink}
      linkable={canvas.canLink && !a.external}
    />
  );
});

/**
 * A glossary term two or more assets share, drawn between them: the reason
 * they are tied, in words, instead of a bare line.
 */
export const ExploreTermNode = React.memo(function ExploreTermNode({ data, selected }: NodeProps<ExploreFlowNode>) {
  const canvas = useExploreCanvas();
  const lod = useLod();
  if (data.node !== "term") return null;
  const entity = data.term.kind === "ENTITY";
  const Icon = entity ? UserRound : BookOpen;
  const what = entity ? canvas.words.entity : canvas.words.concept;
  return (
    <div
      className={cn(
        "relative flex items-center gap-1.5 rounded-[4px] border-2 bg-card px-2.5 text-foreground",
        lod === "chip" ? "text-[22px] font-bold" : "text-[11.5px] font-semibold",
        // The term the canvas is about wears the starting points' ring.
        data.anchor && "ring-2 ring-[var(--cb-select)] ring-offset-2 ring-offset-background",
      )}
      style={{
        width: TERM_CHIP.width,
        height: TERM_CHIP.height,
        borderColor: selected ? "var(--cb-select)" : EXPLORE_KIND_STROKE.meaning,
      }}
      title={`${what}: ${data.term.name} · ${data.count}`}
      data-testid="explore-term"
    >
      {lod !== "chip" && <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{data.term.name}</span>
      {lod !== "chip" && <span className="font-mono text-[10px] text-muted-foreground">{data.count}</span>}
      <Ports connectable={false} hidden />
    </div>
  );
});

/** A lane's name, above its first row. Not interactive. */
export const ExploreLaneNode = React.memo(function ExploreLaneNode({ data }: NodeProps<ExploreFlowNode>) {
  const lod = useLod();
  if (data.node !== "lane" || lod === "chip") return null;
  return (
    <span className="pointer-events-none whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      {data.text}
    </span>
  );
});

export const EXPLORE_NODE_TYPES = {
  "explore-asset": ExploreAssetNode,
  "explore-term": ExploreTermNode,
  "explore-lane": ExploreLaneNode,
};
