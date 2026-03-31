"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2 } from "lucide-react";
import {
  api,
  SearchFindingsFiltersInputDtoSeverityEnum,
  type SearchFindingsChartsResponseDto,
  type SearchFindingsRequestDto,
} from "@workspace/api-client";
import { useSearchParams } from "next/navigation";
import type { FindingSelection } from "@/components/findings-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { FindingsTrendChart } from "@/components/findings-trend-chart";
import { FindingsTable } from "@/components/findings-table";
import { BulkUpdateDialog } from "@/components/bulk-update-dialog";
import { useTranslation } from "@/hooks/use-translation";

type SeverityValue =
  (typeof SearchFindingsFiltersInputDtoSeverityEnum)[keyof typeof SearchFindingsFiltersInputDtoSeverityEnum];

type SeverityPanelKey = "TOTAL" | SeverityValue;

const EMPTY_CHARTS: SearchFindingsChartsResponseDto = {
  totals: {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    open: 0,
    resolved: 0,
  },
  timeline: [],
  topAssets: [],
};

export default function FindingsPage() {
  return (
    <Suspense>
      <FindingsPageContent />
    </Suspense>
  );
}

function FindingsPageContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();

  const [windowDays, setWindowDays] = useState("7");
  const [selectedSeverities, setSelectedSeverities] = useState<SeverityValue[]>(
    () => searchParams.getAll("severity") as SeverityValue[],
  );

  // Full filter state mirrored from the table (including severity)
  const [tableFilters, setTableFilters] =
    useState<SearchFindingsRequestDto["filters"]>(undefined);

  const [baseCharts, setBaseCharts] =
    useState<SearchFindingsChartsResponseDto>(EMPTY_CHARTS);
  const [chartData, setChartData] =
    useState<SearchFindingsChartsResponseDto>(EMPTY_CHARTS);
  const [isBaseLoading, setIsBaseLoading] = useState(true);
  const [isChartsLoading, setIsChartsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bulk update state
  const [selection, setSelection] = useState<FindingSelection | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [tableKey, setTableKey] = useState(0);

  const windowDaysValue =
    windowDays === "7" ? 7 : windowDays === "90" ? 90 : 30;

  // ── Fetch charts whenever any table filter or window changes ────────────────
  //
  // Two requests in parallel:
  //   baseCharts  — all active filters EXCEPT severity → drives panel card numbers
  //                 (each panel card is one severity bucket of the current result set)
  //   chartData   — all active filters INCLUDING severity → drives trend timeline
  //
  // We skip the first render where tableFilters is still undefined; the table
  // emits its initial filters on mount which triggers the first real fetch.

  const firstRender = useRef(true);

  useEffect(() => {
    // Wait until the table has emitted its initial filter state
    if (tableFilters === undefined) return;

    if (firstRender.current) {
      firstRender.current = false;
    }

    let active = true;
    const run = async () => {
      try {
        setIsBaseLoading(true);
        setError(null);

        // Panels: strip severity so each card reflects its own bucket
        const hasSeverityFilter =
          Array.isArray(tableFilters?.severity) &&
          tableFilters.severity.length > 0;
        const filtersWithoutSeverity = tableFilters
          ? ({ ...tableFilters, severity: undefined } as typeof tableFilters)
          : undefined;

        const [panelResponse, trendResponse] = await Promise.all([
          api.searchFindingsCharts({
            windowDays: windowDaysValue,
            filters: filtersWithoutSeverity,
          }),
          hasSeverityFilter
            ? api.searchFindingsCharts({
                windowDays: windowDaysValue,
                filters: tableFilters,
              })
            : Promise.resolve(null),
        ]);

        if (!active) return;
        const panels = panelResponse ?? EMPTY_CHARTS;
        setBaseCharts(panels);
        setChartData(
          hasSeverityFilter ? (trendResponse ?? EMPTY_CHARTS) : panels,
        );
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load findings charts",
        );
        setBaseCharts(EMPTY_CHARTS);
        setChartData(EMPTY_CHARTS);
      } finally {
        if (active) {
          setIsBaseLoading(false);
          setIsChartsLoading(false);
        }
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [tableFilters, windowDaysValue]);

  // ── Panels ─────────────────────────────────────────────────────────────────

  const panels = useMemo(
    () => [
      {
        key: "TOTAL" as const,
        label: "Total Findings",
        value: baseCharts.totals.total,
      },
      {
        key: SearchFindingsFiltersInputDtoSeverityEnum.Critical as SeverityPanelKey,
        label: "Critical",
        value: baseCharts.totals.critical,
      },
      {
        key: SearchFindingsFiltersInputDtoSeverityEnum.High as SeverityPanelKey,
        label: "High",
        value: baseCharts.totals.high,
      },
      {
        key: SearchFindingsFiltersInputDtoSeverityEnum.Medium as SeverityPanelKey,
        label: "Medium",
        value: baseCharts.totals.medium,
      },
      {
        key: SearchFindingsFiltersInputDtoSeverityEnum.Low as SeverityPanelKey,
        label: "Low",
        value: baseCharts.totals.low,
      },
    ],
    [baseCharts],
  );

  const handleSelectionChange = useCallback((s: FindingSelection | null) => {
    setSelection(s);
  }, []);

  const handleFiltersChange = useCallback(
    (filters: SearchFindingsRequestDto["filters"]) => {
      setTableFilters(filters);
      setIsChartsLoading(true);
    },
    [],
  );

  function handleBulkSuccess() {
    setSelection(null);
    setTableKey((k) => k + 1);
  }

  const isLoading = isBaseLoading && baseCharts === EMPTY_CHARTS;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("findings.title")}
        </h1>
        <p className="text-muted-foreground">
          Unified findings table with server-side filtering, plus overview
          charts and stats.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="ml-2 text-sm">Loading findings…</span>
        </div>
      ) : (
        <>
          {/* ── Severity panel cards ── */}
          <div className="relative grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {panels.map((panel) => {
              const isActive =
                panel.key === "TOTAL"
                  ? selectedSeverities.length === 0
                  : selectedSeverities.includes(panel.key as SeverityValue);
              return (
                <button
                  key={panel.key}
                  type="button"
                  className="group text-left cursor-pointer transition-transform hover:-translate-y-px focus-visible:outline-none"
                  onClick={() => {
                    if (panel.key === "TOTAL") {
                      setSelectedSeverities([]);
                    } else {
                      setSelectedSeverities([panel.key as SeverityValue]);
                    }
                  }}
                >
                  <Card
                    className={
                      isActive
                        ? "overflow-hidden border-2 border-[#b7ff00]/30 bg-[#0b0f0a] text-[#b7ff00] rounded-[6px]"
                        : "border-2 border-border rounded-[6px] transition-all group-hover:bg-secondary/40"
                    }
                  >
                    <CardContent className="p-4">
                      <p
                        className={
                          isActive
                            ? "text-[11px] font-mono uppercase tracking-[0.16em] text-[#b7ff00]/80"
                            : "text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground"
                        }
                      >
                        {panel.label}
                      </p>
                      <p
                        className="mt-1 text-3xl font-black"
                        style={{ fontFamily: "var(--font-hero)" }}
                      >
                        {isBaseLoading ? (
                          <span className="inline-block h-8 w-16 animate-pulse rounded bg-current opacity-20" />
                        ) : (
                          panel.value.toLocaleString()
                        )}
                      </p>
                    </CardContent>
                  </Card>
                </button>
              );
            })}

            {isBaseLoading && baseCharts !== EMPTY_CHARTS && (
              <div className="pointer-events-none absolute inset-0 z-10 rounded-[6px] bg-background/30 backdrop-blur-[1px]" />
            )}
          </div>

          {/* ── Trend chart ── */}
          <div className="relative">
            <Card className="panel-card rounded-[6px]">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-sm uppercase tracking-[0.08em]">
                    {t("findings.findingsTrend")}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {t("findings.severityTimeline")}
                  </p>
                </div>
                <Select value={windowDays} onValueChange={setWindowDays}>
                  <SelectTrigger className="h-8 w-[104px] text-xs border-2 border-border rounded-[4px] font-mono">
                    <SelectValue placeholder={t("findings.window.label")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">
                      {t("findings.window.7days")}
                    </SelectItem>
                    <SelectItem value="30">
                      {t("findings.window.30days")}
                    </SelectItem>
                    <SelectItem value="90">
                      {t("findings.window.90days")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                {chartData.timeline.length > 0 ? (
                  <FindingsTrendChart
                    timeline={chartData.timeline}
                    className="h-[260px]"
                  />
                ) : (
                  <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                    {t("findings.noTrendData")}
                  </div>
                )}
              </CardContent>
            </Card>

            {isChartsLoading && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[6px] bg-background/55 backdrop-blur-[1px]">
                <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("findings.updatingChart")}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <FindingsTable
        key={tableKey}
        severities={selectedSeverities}
        onSeveritiesChange={setSelectedSeverities}
        onSelectionChange={handleSelectionChange}
        onBulkUpdate={() => setBulkDialogOpen(true)}
        onFiltersChange={handleFiltersChange}
      />

      <BulkUpdateDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        selection={selection}
        onSuccess={handleBulkSuccess}
      />
    </div>
  );
}
