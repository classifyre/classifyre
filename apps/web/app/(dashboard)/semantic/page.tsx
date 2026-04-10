"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronRight,
  Plus,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  StatsCard,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import type {
  AssistantOperation,
  AssistantUiAction,
} from "@workspace/api-client";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import {
  semanticApi,
  type GlossaryTerm,
  type MetricDefinition,
  type MetricResult,
} from "@/lib/semantic-api";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";

// ── Panel card layout (mirrors discovery page) ────────────────────────────────

function PanelCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[10px] panel-card bg-card p-4 sm:p-6 text-card-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  label,
  count,
  onNew,
  newLabel,
}: {
  icon: React.ElementType;
  label: string;
  count: number;
  onNew: () => void;
  newLabel: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
          {label}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          ({count})
        </span>
      </div>
      <button
        type="button"
        onClick={onNew}
        className="inline-flex items-center gap-1 rounded-[4px] border-2 border-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        {newLabel}
      </button>
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const METRIC_TYPE_LABELS_KEYS: Record<string, string> = {
  SIMPLE: "typeSIMPLE",
  RATIO: "typeRATIO",
  DERIVED: "typeDERIVED",
  TREND: "typeTREND",
};

const DIMENSIONS = [
  "severity",
  "detectorType",
  "status",
  "findingType",
  "category",
];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SemanticLayerPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTerm[]>([]);
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  // Explore state
  const [exploreOpen, setExploreOpen] = useState(false);
  const [selectedTerm, setSelectedTerm] = useState("");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [selectedDimension, setSelectedDimension] = useState("");
  const [results, setResults] = useState<
    (MetricResult & { metricId: string })[]
  >([]);
  const [querying, setQuerying] = useState(false);

  const reload = async () => {
    try {
      const [glossaryRes, metricsRes] = await Promise.all([
        semanticApi.glossary.list(),
        semanticApi.metrics.list(),
      ]);
      setGlossaryTerms(glossaryRes.items);
      setMetrics(metricsRes.items);
    } catch (err) {
      console.error("Failed to load semantic layer data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const assistantBridge = useMemo(
    () => ({
      contextKey: "semantic.glossary" as const,
      canOpen: true,
      getContext: () => ({
        key: "semantic.glossary" as const,
        route: "/semantic",
        title: "Semantic Layer Assistant",
        entityId: null,
        values: {},
        validation: { isValid: false, missingFields: [], errors: [] },
        metadata: {
          existingTerms: glossaryTerms.map((term) => term.id),
          existingMetrics: metrics.map((m) => m.id),
        },
        supportedOperations: [
          "create_glossary_term",
          "create_metric_definition",
        ] as AssistantOperation[],
      }),
      applyAction: async (action: AssistantUiAction) => {
        if (action.type === "show_toast") {
          toast[action.tone ?? "info"](action.title, {
            description: action.description,
          });
        }
        if (
          action.type === "sync_glossary_term" ||
          action.type === "sync_metric"
        ) {
          await reload();
        }
      },
    }),
    [glossaryTerms, metrics],
  );

  useRegisterAssistantBridge(assistantBridge);

  const handleDeleteTerm = async (id: string) => {
    try {
      await semanticApi.glossary.delete(id);
      setGlossaryTerms((prev) => prev.filter((term) => term.id !== id));
      toast.success(t("semantic.glossary.deleted"));
    } catch {
      toast.error(t("semantic.glossary.failedToDelete"));
    }
  };

  const handleDeleteMetric = async (id: string) => {
    try {
      await semanticApi.metrics.delete(id);
      setMetrics((prev) => prev.filter((m) => m.id !== id));
      toast.success(t("semantic.metrics.deleted"));
    } catch {
      toast.error(t("semantic.metrics.failedToDelete"));
    }
  };

  void handleDeleteTerm;
  void handleDeleteMetric;

  const toggleExploreMetric = (id: string) => {
    setSelectedMetrics((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const handleExplore = async () => {
    if (selectedMetrics.length === 0) return;
    setQuerying(true);
    try {
      const promises = selectedMetrics.map((id) =>
        semanticApi.query
          .evaluate({
            metricId: id,
            dimensions: selectedDimension ? [selectedDimension] : undefined,
            glossaryTermId: selectedTerm || undefined,
          })
          .then((r) => ({ ...r, metricId: id })),
      );
      setResults(await Promise.all(promises));
    } catch (err) {
      console.error("Failed to query:", err);
    } finally {
      setQuerying(false);
    }
  };

  const getMetricMeta = (id: string) => metrics.find((m) => m.id === id);

  const formatValue = (v: number | null, id: string) => {
    if (v === null) return "—";
    const meta = getMetricMeta(id);
    if (meta?.format === "percentage") return `${(v * 100).toFixed(1)}%`;
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(2);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const totalFindings = glossaryTerms.reduce(
    (sum, t) => sum + (t.findingCount ?? 0),
    0,
  );

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
            {t("semantic.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("semantic.description")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push("/semantic/glossary/new")}
            className="rounded-[4px] border-2 border-border"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("semantic.newTerm")}
          </Button>
          <Button
            size="sm"
            onClick={() => router.push("/semantic/metrics/new")}
            className="rounded-[4px] border-2 border-black bg-black text-white hover:bg-black/90"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("semantic.newMetric")}
          </Button>
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatsCard
          title={t("semantic.statBusinessTerms")}
          value={glossaryTerms.length}
          icon={BookOpen}
          description={t("semantic.statBusinessTermsDesc")}
        />
        <StatsCard
          title={t("semantic.statMetrics")}
          value={metrics.length}
          icon={BarChart3}
          description={t("semantic.statMetricsDesc")}
        />
        <StatsCard
          title={t("semantic.statFindingsCovered")}
          value={totalFindings > 0 ? totalFindings.toLocaleString() : "—"}
          icon={Activity}
          description={t("semantic.statFindingsCoveredDesc")}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {/* ── Explore panel ── */}
      <PanelCard>
        <button
          type="button"
          className="flex w-full items-center justify-between"
          onClick={() => setExploreOpen((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
              {t("semantic.exploreMetrics")}
            </span>
            {results.length > 0 && (
              <span className="rounded-sm bg-foreground/10 px-1.5 py-0.5 font-mono text-[9px] text-foreground">
                {results.length} result{results.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              exploreOpen && "rotate-90",
            )}
          />
        </button>

        {exploreOpen && (
          <div className="mt-5 space-y-5">
            {/* Controls row */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {t("semantic.filterByTerm")}
                </p>
                <Select
                  value={selectedTerm || "__all__"}
                  onValueChange={(v) =>
                    setSelectedTerm(v === "__all__" ? "" : v)
                  }
                >
                  <SelectTrigger className="rounded-[4px] border-2 border-border">
                    <SelectValue placeholder={t("semantic.allData")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">
                      {t("semantic.allData")}
                    </SelectItem>
                    {glossaryTerms.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {t("semantic.dimension")}
                </p>
                <Select
                  value={selectedDimension || "__none__"}
                  onValueChange={(v) =>
                    setSelectedDimension(v === "__none__" ? "" : v)
                  }
                >
                  <SelectTrigger className="rounded-[4px] border-2 border-border">
                    <SelectValue placeholder={t("common.none")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("common.none")}</SelectItem>
                    {DIMENSIONS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button
                  onClick={handleExplore}
                  disabled={selectedMetrics.length === 0 || querying}
                  className="w-full rounded-[4px] border-2 border-black bg-black text-white hover:bg-black/90"
                >
                  {querying ? t("semantic.running") : t("semantic.runExplore")}
                </Button>
              </div>
            </div>

            {/* Metric toggles */}
            {metrics.length > 0 && (
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {t("semantic.selectMetrics")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {metrics.map((m) => (
                    <Badge
                      key={m.id}
                      variant={
                        selectedMetrics.includes(m.id) ? "default" : "outline"
                      }
                      className="cursor-pointer text-[10px] transition-colors"
                      onClick={() => toggleExploreMetric(m.id)}
                    >
                      {m.displayName}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {metrics.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t("semantic.createMetricsFirst")}
              </p>
            )}

            {/* Results */}
            {querying && (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            )}

            {!querying && results.length > 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {results.map((r) => {
                    const meta = getMetricMeta(r.metricId);
                    return (
                      <div
                        key={r.metricId}
                        className="rounded-[4px] border-2 border-border bg-background p-3"
                      >
                        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                          {meta?.displayName ?? r.metricId}
                        </p>
                        <p className="mt-1 font-serif text-3xl font-bold leading-none">
                          {formatValue(r.value, r.metricId)}
                        </p>
                        {meta?.unit && (
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                            {meta.unit}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {results
                  .filter((r) => r.breakdown && r.breakdown.length > 0)
                  .map((r) => {
                    const meta = getMetricMeta(r.metricId);
                    const maxVal = Math.max(
                      ...(r.breakdown?.map((b) => b.value) ?? [1]),
                      1,
                    );
                    return (
                      <div
                        key={`bd-${r.metricId}`}
                        className="rounded-[4px] border-2 border-border bg-background p-3"
                      >
                        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                          {meta?.displayName ?? r.metricId} by{" "}
                          {selectedDimension}
                        </p>
                        <div className="space-y-2">
                          {r.breakdown!.map((b) => (
                            <div
                              key={b.dimensionValue}
                              className="flex items-center gap-3"
                            >
                              <span className="w-24 truncate font-mono text-[11px]">
                                {b.dimensionValue}
                              </span>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/50">
                                <div
                                  className="h-full rounded-full bg-foreground"
                                  style={{
                                    width: `${(b.value / maxVal) * 100}%`,
                                  }}
                                />
                              </div>
                              <span className="w-12 text-right font-mono text-[11px]">
                                {b.value.toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}
      </PanelCard>

      {/* ── Business Terms ── */}
      <PanelCard>
        <SectionHeader
          icon={BookOpen}
          label={t("semantic.statBusinessTerms")}
          count={glossaryTerms.length}
          onNew={() => router.push("/semantic/glossary/new")}
          newLabel={t("common.new")}
        />

        {glossaryTerms.length === 0 ? (
          <div className="rounded-[4px] border-2 border-dashed border-border py-10 text-center">
            <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium">{t("semantic.noTermsYet")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("semantic.noTermsDesc")}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-4 rounded-[4px] border-2 border-border"
              onClick={() => router.push("/semantic/glossary/new")}
            >
              <Plus className="mr-1 h-3 w-3" />
              {t("semantic.createFirstTerm")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {glossaryTerms.map((term) => {
              const linkedMetrics = metrics.filter(
                (m) => m.glossaryTermId === term.id,
              );
              const filterCount = Object.values(term.filterMapping ?? {}).flat()
                .length;

              return (
                <button
                  key={term.id}
                  type="button"
                  onClick={() => router.push(`/semantic/glossary/${term.id}`)}
                  className="group relative w-full overflow-hidden rounded-[4px] border-2 border-border bg-background px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:bg-secondary/30"
                  style={
                    term.color
                      ? { borderLeftColor: term.color, borderLeftWidth: "3px" }
                      : undefined
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {term.displayName}
                      </p>
                      {term.category && (
                        <Badge variant="outline" className="mt-1 text-[9px]">
                          {term.category}
                        </Badge>
                      )}
                      {term.description && (
                        <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">
                          {term.description}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2">
                    {filterCount > 0 && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {filterCount} filter{filterCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {linkedMetrics.length > 0 && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {linkedMetrics.length} metric
                        {linkedMetrics.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {(term.filterMapping?.customDetectorKeys ?? []).length >
                      0 && (
                      <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
                        <Sparkles className="h-2.5 w-2.5" />
                        auto-detect
                      </span>
                    )}
                    {term.findingCount != null && term.findingCount > 0 && (
                      <span className="ml-auto font-mono text-[10px] font-semibold text-foreground">
                        {term.findingCount.toLocaleString()} findings
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PanelCard>

      {/* ── Metrics ── */}
      <PanelCard>
        <SectionHeader
          icon={BarChart3}
          label={t("semantic.statMetrics")}
          count={metrics.length}
          onNew={() => router.push("/semantic/metrics/new")}
          newLabel={t("common.new")}
        />

        {metrics.length === 0 ? (
          <div className="rounded-[4px] border-2 border-dashed border-border py-10 text-center">
            <BarChart3 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium">{t("semantic.noMetricsYet")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("semantic.noMetricsDesc")}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-4 rounded-[4px] border-2 border-border"
              onClick={() => router.push("/semantic/metrics/new")}
            >
              <Plus className="mr-1 h-3 w-3" />
              {t("semantic.createFirstMetric")}
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {metrics.map((metric) => (
              <button
                key={metric.id}
                type="button"
                onClick={() => router.push(`/semantic/metrics/${metric.id}`)}
                className="group flex w-full items-center gap-3 rounded-[4px] border-2 border-border bg-background px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:bg-secondary/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                      {metric.displayName}
                    </span>
                    <Badge
                      variant={
                        metric.status === "ACTIVE" ? "default" : "outline"
                      }
                      className="text-[9px]"
                    >
                      {metric.status}
                    </Badge>
                    <Badge variant="outline" className="font-mono text-[9px]">
                      {METRIC_TYPE_LABELS_KEYS[metric.type]
                        ? t(
                            `semantic.metrics.${METRIC_TYPE_LABELS_KEYS[metric.type]}` as Parameters<
                              typeof t
                            >[0],
                          )
                        : metric.type}
                    </Badge>
                  </div>
                  {metric.description && (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                      {metric.description}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {metric.glossaryTerm && (
                    <Badge
                      variant="outline"
                      className="hidden text-[9px] sm:inline-flex"
                    >
                      {metric.glossaryTerm.displayName}
                    </Badge>
                  )}
                  {metric.currentValue != null && (
                    <span className="font-serif font-bold">
                      {metric.format === "percentage"
                        ? `${(metric.currentValue * 100).toFixed(1)}%`
                        : metric.currentValue.toLocaleString()}
                    </span>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            ))}
          </div>
        )}
      </PanelCard>
    </div>
  );
}
