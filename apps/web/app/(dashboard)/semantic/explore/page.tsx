"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@workspace/ui/components";
import { PageTitle } from "@/components/page-title";
import {
  semanticApi,
  type GlossaryTerm,
  type MetricDefinition,
  type MetricResult,
} from "@/lib/semantic-api";
import { TrendingUp, BarChart3 } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

const DIMENSIONS = [
  "severity",
  "detectorType",
  "status",
  "findingType",
  "category",
];

export default function MetricExplorerPage() {
  const { t } = useTranslation();
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTerm[]>([]);
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedTerm, setSelectedTerm] = useState("");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [selectedDimension, setSelectedDimension] = useState("");
  const [results, setResults] = useState<
    (MetricResult & { metricId: string })[]
  >([]);
  const [querying, setQuerying] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [gRes, mRes] = await Promise.all([
          semanticApi.glossary.list(),
          semanticApi.metrics.list(),
        ]);
        setGlossaryTerms(gRes.items);
        setMetrics(mRes.items);
      } catch (err) {
        console.error("Failed to load:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const toggleMetric = (id: string) => {
    setSelectedMetrics((prev) =>
      prev.includes(id)
        ? prev.filter((s) => s !== id)
        : [...prev, id],
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
      const res = await Promise.all(promises);
      setResults(res);
    } catch (err) {
      console.error("Failed to query:", err);
    } finally {
      setQuerying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const getMetricDisplay = (id: string) =>
    metrics.find((m) => m.id === id);

  return (
    <div className="space-y-6 p-6">
      <PageTitle
        title={t("semantic.explore.title")}
        description={t("semantic.explore.description")}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Controls */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm">{t("semantic.explore.configuration")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs font-medium">{t("semantic.explore.glossaryTerm")}</label>
              <Select
                value={selectedTerm || "__all__"}
                onValueChange={(v) => setSelectedTerm(v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={t("semantic.explore.allData")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("semantic.explore.allData")}</SelectItem>
                  {glossaryTerms.map((term) => (
                    <SelectItem key={term.id} value={term.id}>
                      {term.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-medium">{t("semantic.explore.metrics")}</label>
              <div className="mt-1 flex flex-wrap gap-1">
                {metrics.map((m) => (
                  <Badge
                    key={m.id}
                    variant={
                      selectedMetrics.includes(m.id) ? "default" : "outline"
                    }
                    className="cursor-pointer text-[10px]"
                    onClick={() => toggleMetric(m.id)}
                  >
                    {m.displayName}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium">{t("semantic.explore.dimensionBreakdown")}</label>
              <Select
                value={selectedDimension || "__none__"}
                onValueChange={(v) =>
                  setSelectedDimension(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={t("semantic.explore.none")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("semantic.explore.none")}</SelectItem>
                  {DIMENSIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleExplore}
              disabled={selectedMetrics.length === 0 || querying}
              className="w-full"
            >
              {querying ? t("semantic.explore.querying") : t("semantic.explore.explore")}
            </Button>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="space-y-4 lg:col-span-3">
          {results.length === 0 && !querying && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-muted-foreground">
              <TrendingUp className="mb-3 h-10 w-10" />
              <p>{t("semantic.explore.emptyState")}</p>
            </div>
          )}

          {querying && (
            <div className="flex items-center justify-center py-16">
              <Spinner />
            </div>
          )}

          {!querying && results.length > 0 && (
            <>
              {/* Metric Value Cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {results.map((r) => {
                  const meta = getMetricDisplay(r.metricId);
                  const formatValue = (v: number | null) => {
                    if (v === null) return "—";
                    if (meta?.format === "percentage")
                      return `${(v * 100).toFixed(1)}%`;
                    if (Number.isInteger(v)) return v.toLocaleString();
                    return v.toFixed(2);
                  };

                  return (
                    <Card key={r.metricId}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-muted-foreground">
                          {meta?.displayName ?? r.metricId}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="font-hero text-3xl">
                          {formatValue(r.value)}
                        </p>
                        {meta?.unit && (
                          <p className="text-xs text-muted-foreground">
                            {meta.unit}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Dimension Breakdowns */}
              {results
                .filter((r) => r.breakdown && r.breakdown.length > 0)
                .map((r) => {
                  const meta = getMetricDisplay(r.metricId);
                  const maxVal = Math.max(
                    ...r.breakdown!.map((b) => b.value),
                    1,
                  );

                  return (
                    <Card key={`breakdown-${r.metricId}`}>
                      <CardHeader>
                        <CardTitle className="text-sm">
                          {meta?.displayName ?? r.metricId} by{" "}
                          {selectedDimension}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {r.breakdown!.map((b) => (
                          <div
                            key={b.dimensionValue}
                            className="flex items-center gap-3"
                          >
                            <span className="w-28 text-xs font-medium truncate">
                              {b.dimensionValue}
                            </span>
                            <div className="flex-1">
                              <div
                                className="h-6 rounded bg-primary/20"
                                style={{
                                  width: `${(b.value / maxVal) * 100}%`,
                                  minWidth: "4px",
                                }}
                              >
                                <div
                                  className="h-full rounded bg-primary"
                                  style={{
                                    width: `${(b.value / maxVal) * 100}%`,
                                    minWidth: "4px",
                                  }}
                                />
                              </div>
                            </div>
                            <span className="w-16 text-right font-mono text-xs">
                              {b.value.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
