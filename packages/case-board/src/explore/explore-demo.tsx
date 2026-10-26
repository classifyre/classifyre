"use client";

import * as React from "react";
import { cn } from "@workspace/ui/lib/utils";
import { ENGLISH_WORDS } from "./canvas-context";
import { ExploreCanvas, type ExploreSpotlight } from "./explore-canvas";
import { KindLine } from "./kind-line";
import { EXPLORE_KINDS, termNodeId, type ExploreGraph, type ExploreKind, type ExploreLink, type ExploreSelection } from "./model";

/**
 * A small, live Explore canvas for the documentation: the app's own canvas,
 * fed from a written scene. The counters light one kind of connection,
 * clicking anything says why it is there, a double click on a neighbour
 * walks on (when the scene has that view), and a line pulled from one asset
 * to another draws a link. Nothing is saved.
 */
export interface ExploreScene {
  /** The view it opens on. */
  start: string;
  /** Views by the asset they start from. */
  views: Record<string, ExploreGraph>;
  /** Kinds drawn (default: all). */
  kinds?: ExploreKind[];
}

export function ExploreDemo({
  scene,
  height = 460,
  className,
  label,
}: {
  scene: ExploreScene;
  height?: number;
  className?: string;
  label?: string;
}) {
  const [viewId, setViewId] = React.useState(scene.start);
  const kinds = React.useMemo<ReadonlySet<ExploreKind>>(() => new Set(scene.kinds ?? EXPLORE_KINDS), [scene.kinds]);
  const [spotlight, setSpotlight] = React.useState<ExploreSpotlight | null>(null);
  const [selection, setSelection] = React.useState<ExploreSelection | null>(null);
  const [drawn, setDrawn] = React.useState<ExploreLink[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);
  const base = scene.views[viewId] ?? scene.views[scene.start]!;
  const graph = React.useMemo<ExploreGraph>(() => ({ ...base, links: [...base.links, ...drawn] }), [base, drawn]);

  const walk = (assetId: string) => {
    setSelection(null);
    setSpotlight(null);
    if (scene.views[assetId]) {
      setViewId(assetId);
      setDrawn([]);
      setMessage(null);
    } else {
      const name = graph.assets.find((a) => a.id === assetId)?.label ?? "It";
      setMessage(`In the app, "${name}" becomes a starting point and its own connections come in.`);
    }
  };

  const link = (from: string, to: string) => {
    const a = graph.assets.find((x) => x.id === from)?.label;
    const b = graph.assets.find((x) => x.id === to)?.label;
    setDrawn((current) => [
      ...current,
      { id: `drawn:${current.length}`, source: from, target: to, kind: "links", label: "related to", manual: true, directed: false },
    ]);
    setMessage(`In the app you say what the link means and why. It stays through re-scans, and goes when "${a}" or "${b}" is deleted at its source.`);
  };

  const counts = React.useMemo(() => {
    const out = new Map<ExploreKind, number>();
    for (const k of EXPLORE_KINDS) out.set(k, base.assets.filter((a) => a.side !== "seed" && a.kinds.includes(k)).length);
    return out;
  }, [base]);
  const shown = EXPLORE_KINDS.filter((k) => kinds.has(k));

  return (
    <div className={cn("overflow-hidden rounded-[4px] border-2 border-border bg-background", className)} role="figure" aria-label={label}>
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-border px-3 py-2">
        <div role="group" className="flex h-9 items-stretch overflow-x-auto rounded-[4px] border-2 border-border bg-card">
          {shown.map((kind, i) => {
            const active = spotlight === kind;
            const value = counts.get(kind) ?? 0;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  setSelection(null);
                  setSpotlight(active ? null : kind);
                }}
                aria-pressed={active}
                disabled={value === 0 && !active}
                className={cn(
                  "flex items-center gap-2 px-3 whitespace-nowrap transition-colors disabled:opacity-45",
                  i > 0 && "border-l-2 border-border",
                  active ? "bg-foreground text-background" : "enabled:hover:bg-muted",
                )}
              >
                <KindLine kind={kind} />
                <span className="font-mono text-[15px] leading-none font-bold tabular-nums">{value}</span>
                <span className={cn("font-mono text-[10px] leading-none tracking-[0.12em] uppercase", active ? "text-background/75" : "text-muted-foreground")}>
                  {ENGLISH_WORDS.kinds[kind]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative">
        <ExploreCanvas
          graph={graph}
          kinds={kinds}
          selection={selection}
          onSelect={(next) => {
            setSelection(next);
            if (next) setSpotlight(null);
          }}
          spotlight={spotlight}
          onWalk={walk}
          onLink={link}
          fitKey={viewId}
          zoomOnScroll={false}
          style={{ height }}
        />
        {message && (
          <div
            role="status"
            className="pointer-events-none absolute inset-x-3 top-3 mx-auto max-w-md rounded-[6px] border-2 border-foreground bg-card px-3 py-2 text-center text-xs leading-snug text-card-foreground"
          >
            {message}
          </div>
        )}
      </div>
      <p className="min-h-10 border-t-2 border-border px-3 py-2 text-xs leading-snug text-muted-foreground">
        {describe(graph, selection) ?? "Light a counter, click an asset, a term or a line to read why it is here, or double-click a neighbour to walk on."}
      </p>
    </div>
  );
}

function describe(graph: ExploreGraph, selection: ExploreSelection | null): string | null {
  if (!selection) return null;
  if (selection.type === "asset") {
    const a = graph.assets.find((x) => x.id === selection.id);
    if (!a) return null;
    const marks = [
      a.cases?.length ? `evidence in ${a.cases.join(", ")}` : null,
      a.watches?.length ? `answers the watch ${a.watches.join(", ")}` : null,
    ].filter(Boolean);
    if (a.side === "seed") return `${a.label} is where this view starts${marks.length ? `; ${marks.join("; ")}` : ""}.`;
    const ways = a.kinds.map((k) => ENGLISH_WORDS.kinds[k].toLowerCase()).join(", ");
    return `${a.label}${a.sourceName ? ` (${a.sourceName})` : ""}: reached by ${ways}${marks.length ? `; ${marks.join("; ")}` : ""}.`;
  }
  if (selection.type === "term") {
    const t = graph.terms.find((x) => x.id === selection.id);
    if (!t) return null;
    const holders = graph.links.filter((l) => l.target === termNodeId(t.id)).length;
    return `${t.kind === "ENTITY" ? "Entity" : "Concept"} "${t.name}": ${holders} assets on the canvas are about it.`;
  }
  const l = graph.links.find((x) => x.id === selection.id);
  if (!l) return null;
  const name = (id: string) =>
    id.startsWith("term:")
      ? (graph.terms.find((t) => termNodeId(t.id) === id)?.name ?? id)
      : (graph.assets.find((a) => a.id === id)?.label ?? id);
  return `${name(l.source)} → ${name(l.target)}: ${l.label}${l.manual ? " (drawn by a person)" : ""}.`;
}
