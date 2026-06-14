"use client";

import * as React from "react";
import type { ThreadResponseDto } from "@workspace/api-client";
import { Plus } from "lucide-react";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components/multi-select";
import { ACCENT, CROSS_HYP_COLOR, MANUAL_EDGE_COLOR } from "./graph-types";
import { useTranslation } from "@/hooks/use-translation";

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
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>{t("caseGraph.sidebar.hypothesesTitle")}</SectionTitle>
        <button
          onClick={onNewHypothesis}
          className="flex items-center gap-1 border-2 border-border bg-card px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors hover:border-foreground"
        >
          <Plus className="h-3 w-3" /> {t("common.new")}
        </button>
      </div>
      {hypotheses.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t("caseGraph.sidebar.noHypotheses")}
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
              title={focused ? t("caseGraph.sidebar.clearFocus") : t("caseGraph.sidebar.focusHypothesis")}
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

export interface HighlightOption {
  value: string;
  label: string;
  count: number;
}

export interface HighlightFiltersProps {
  sourceOptions: HighlightOption[];
  detectorOptions: HighlightOption[];
  sourceFilter: string[];
  detectorFilter: string[];
  onSourceChange: (values: string[]) => void;
  onDetectorChange: (values: string[]) => void;
}

/**
 * Gray-out highlighting by source type / finding category. Matching nodes stay
 * at full color, everything else dims — nothing is removed from the graph.
 */
export function HighlightFilters({
  sourceOptions,
  detectorOptions,
  sourceFilter,
  detectorFilter,
  onSourceChange,
  onDetectorChange,
}: HighlightFiltersProps) {
  const { t } = useTranslation();
  const active = sourceFilter.length > 0 || detectorFilter.length > 0;
  if (sourceOptions.length === 0 && detectorOptions.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>{t("caseGraph.sidebar.highlight")}</SectionTitle>
        {active && (
          <button
            onClick={() => {
              onSourceChange([]);
              onDetectorChange([]);
            }}
            className="font-mono text-[10px] uppercase text-muted-foreground underline"
          >
            {t("caseGraph.sidebar.clear")}
          </button>
        )}
      </div>
      {sourceOptions.length > 0 && (
        <MultiSelect values={sourceFilter} onValuesChange={onSourceChange}>
          <MultiSelectTrigger className="h-8 w-full border-2 border-border rounded-[2px] text-xs">
            <MultiSelectValue placeholder={t("caseGraph.sidebar.sourcesPlaceholder")} overflowBehavior="cutoff" />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{ placeholder: t("caseGraph.sidebar.searchSources"), emptyMessage: t("caseGraph.sidebar.noSources") }}
          >
            <MultiSelectGroup>
              {sourceOptions.map((o) => (
                <MultiSelectItem key={o.value} value={o.value}>
                  <span className="font-mono text-xs uppercase">{o.label}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">({o.count})</span>
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>
      )}
      {detectorOptions.length > 0 && (
        <MultiSelect values={detectorFilter} onValuesChange={onDetectorChange}>
          <MultiSelectTrigger className="h-8 w-full border-2 border-border rounded-[2px] text-xs">
            <MultiSelectValue placeholder={t("caseGraph.sidebar.categoriesPlaceholder")} overflowBehavior="cutoff" />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{ placeholder: t("caseGraph.sidebar.searchCategories"), emptyMessage: t("caseGraph.sidebar.noCategories") }}
          >
            <MultiSelectGroup>
              {detectorOptions.map((o) => (
                <MultiSelectItem key={o.value} value={o.value}>
                  <span className="text-xs">{o.label}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">({o.count})</span>
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>
      )}
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
  const { t } = useTranslation();
  if (edgeTypes.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>{t("caseGraph.sidebar.edgeTypes")}</SectionTitle>
        {activeEdgeTypes.size > 0 && (
          <button onClick={onClear} className="font-mono text-[10px] uppercase text-muted-foreground underline">
            {t("caseGraph.sidebar.clear")}
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
  const { t } = useTranslation();
  const rows: Array<[string, number]> = [
    [t("caseGraph.sidebar.statsAssets"), props.assetCount],
    [t("caseGraph.sidebar.statsFindings"), props.findingCount],
    [t("caseGraph.sidebar.statsEvidenceRecords"), props.evidenceCount],
    [t("caseGraph.sidebar.statsManualEdges"), props.manualEdgeCount],
    [t("caseGraph.sidebar.statsInferredEdges"), props.inferredEdgeCount],
    [t("caseGraph.sidebar.statsUnattached"), props.attachableTotal],
  ];
  return (
    <div className="space-y-2">
      <SectionTitle>{t("caseGraph.sidebar.legendTitle")}</SectionTitle>
      <div className="space-y-1.5 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2" style={{ borderColor: ACCENT }} />
          <span className="text-muted-foreground">{t("caseGraph.sidebar.legendEvidence")}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-dashed"
            style={{ borderColor: CROSS_HYP_COLOR }}
          />
          <span className="text-muted-foreground">{t("caseGraph.sidebar.legendHypothesis")}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3.5 shrink-0" style={{ background: MANUAL_EDGE_COLOR }} />
          <span className="text-muted-foreground">{t("caseGraph.sidebar.legendManual")}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center border font-mono text-[8px] font-bold" style={{ background: ACCENT, color: "#0a0a0a" }}>
            +n
          </span>
          <span className="text-muted-foreground">{t("caseGraph.sidebar.legendUnattached")}</span>
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
