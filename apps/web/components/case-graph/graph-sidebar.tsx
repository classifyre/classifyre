"use client";

import * as React from "react";
import type { ThreadResponseDto } from "@workspace/api-client";
import { Plus } from "lucide-react";
import { ACCENT, CROSS_HYP_COLOR, MANUAL_EDGE_COLOR } from "./graph-types";

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </p>
  );
}

const STATUS_STYLES: Record<string, string> = {
  PROPOSED: "text-muted-foreground border-border",
  SUPPORTED: "text-green-700 dark:text-green-400 border-green-600",
  REFUTED: "text-destructive border-destructive",
  INCONCLUSIVE: "text-amber-700 dark:text-amber-400 border-amber-600",
};

export interface HypothesisLegendProps {
  hypotheses: ThreadResponseDto[];
  hypothesisColors: Record<string, string>;
  memberCounts: Map<string, number>;
  focusId: string | null;
  onToggleFocus: (id: string) => void;
  onNewHypothesis: () => void;
}

export function HypothesisLegend({
  hypotheses,
  hypothesisColors,
  memberCounts,
  focusId,
  onToggleFocus,
  onNewHypothesis,
}: HypothesisLegendProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>Hypotheses</SectionTitle>
        <button
          onClick={onNewHypothesis}
          className="flex items-center gap-1 border-2 border-border bg-card px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors hover:border-foreground"
        >
          <Plus className="h-3 w-3" /> New
        </button>
      </div>
      {hypotheses.length === 0 && (
        <p className="text-xs text-muted-foreground">
          None yet. Hypotheses let you group evidence into competing explanations.
        </p>
      )}
      <div className="space-y-1.5">
        {hypotheses.map((h) => {
          const focused = focusId === h.id;
          const color = hypothesisColors[h.id] ?? "#888888";
          const status = h.status ?? "PROPOSED";
          return (
            <button
              key={h.id}
              onClick={() => onToggleFocus(h.id)}
              title={focused ? "Click to clear focus" : "Click to focus this hypothesis"}
              className={`w-full border-2 bg-card p-2 text-left transition-colors ${
                focused ? "border-foreground shadow-[3px_3px_0_0_var(--color-border)]" : "border-border hover:border-foreground/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 border border-foreground/40" style={{ background: color }} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{h.title}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {memberCounts.get(h.id) ?? 0}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 pl-5">
                <span
                  className={`border px-1 font-mono text-[9px] uppercase tracking-wide ${STATUS_STYLES[status] ?? STATUS_STYLES.PROPOSED}`}
                >
                  {status.toLowerCase()}
                </span>
                {typeof h.confidence === "number" && (
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {Math.round(h.confidence * 100)}% confidence
                  </span>
                )}
                <span className="font-mono text-[9px] text-muted-foreground">
                  +{h.supportingCount} / −{h.contradictingCount}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface EdgeTypeFiltersProps {
  edgeTypes: Array<{ type: string; count: number }>;
  activeEdgeTypes: Set<string>;
  onToggle: (type: string) => void;
  onClear: () => void;
}

export function EdgeTypeFilters({ edgeTypes, activeEdgeTypes, onToggle, onClear }: EdgeTypeFiltersProps) {
  if (edgeTypes.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>Edge types</SectionTitle>
        {activeEdgeTypes.size > 0 && (
          <button onClick={onClear} className="font-mono text-[10px] uppercase text-muted-foreground underline">
            clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {edgeTypes.map(({ type, count }) => {
          const active = activeEdgeTypes.size === 0 || activeEdgeTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => onToggle(type)}
              className={`border-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide transition-colors ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground/50"
              }`}
            >
              {type} <span className="opacity-60">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface GraphStatsProps {
  assetCount: number;
  findingCount: number;
  evidenceCount: number;
  manualEdgeCount: number;
  inferredEdgeCount: number;
  attachableTotal: number;
}

export function GraphLegendAndStats(props: GraphStatsProps) {
  const rows: Array<[string, number]> = [
    ["Assets", props.assetCount],
    ["Findings", props.findingCount],
    ["Evidence records", props.evidenceCount],
    ["Manual edges", props.manualEdgeCount],
    ["Inferred edges", props.inferredEdgeCount],
    ["Unattached findings", props.attachableTotal],
  ];
  return (
    <div className="space-y-2">
      <SectionTitle>Reading the graph</SectionTitle>
      <div className="space-y-1.5 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2" style={{ borderColor: ACCENT }} />
          <span className="text-muted-foreground">green ring = case evidence</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-dashed"
            style={{ borderColor: CROSS_HYP_COLOR }}
          />
          <span className="text-muted-foreground">dashed purple = spans hypotheses</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3.5 shrink-0" style={{ background: MANUAL_EDGE_COLOR }} />
          <span className="text-muted-foreground">amber dashed edge = manual link</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center border font-mono text-[8px] font-bold" style={{ background: ACCENT, color: "#0a0a0a" }}>
            +n
          </span>
          <span className="text-muted-foreground">findings not yet attached — click to review</span>
        </div>
      </div>
      <div className="divide-y divide-border border-2 border-border bg-card">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-2 py-1">
            <span className="text-[11px] text-muted-foreground">{label}</span>
            <span className="font-mono text-[11px] font-bold tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
