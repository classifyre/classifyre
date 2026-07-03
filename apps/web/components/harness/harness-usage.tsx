"use client";

import * as React from "react";
import { Coins, Loader2 } from "lucide-react";
import { api, type AgentUsageResponseDto } from "@workspace/api-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { EChartBox } from "@/components/echart-box";
import { useFormatDuration } from "@/hooks/use-format-duration";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

const AGENT_KINDS = [
  "INQUIRY",
  "CASE",
  "CONFIG",
  "DETECTOR_AUTHOR",
  "DREAM",
  "DUPLICATES",
] as const;

/**
 * Fixed per-agent hue assignment (never cycled) — validated for CVD
 * separation and surface contrast in both modes.
 */
const AGENT_COLORS: Record<string, { light: string; dark: string }> = {
  INQUIRY: { light: "#3B82F6", dark: "#3B82F6" },
  CASE: { light: "#F59E0B", dark: "#D97706" },
  CONFIG: { light: "#10B981", dark: "#059669" },
  DETECTOR_AUTHOR: { light: "#8B5CF6", dark: "#8B5CF6" },
  DREAM: { light: "#EC4899", dark: "#EC4899" },
  DUPLICATES: { light: "#06B6D4", dark: "#0891B2" },
};

const INPUT_COLOR = { light: "#3B82F6", dark: "#3B82F6" };
const OUTPUT_COLOR = { light: "#F59E0B", dark: "#D97706" };

const ALL_VALUE = "__all__";

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatCost(usd: number): string {
  return usd >= 100 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`;
}

type ThemeColors = {
  mutedForeground: string;
  border: string;
  dark: boolean;
};

const DEFAULT_THEME: ThemeColors = {
  mutedForeground: "#64748B",
  border: "#CBD5F5",
  dark: false,
};

function resolveThemeColors(): ThemeColors {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    mutedForeground: read("--muted-foreground", DEFAULT_THEME.mutedForeground),
    border: read("--border", DEFAULT_THEME.border),
    dark: document.documentElement.classList.contains("dark"),
  };
}

/** Enumerate UTC days (YYYY-MM-DD) between two instants, inclusive. */
function enumerateDays(since: Date, until: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(
    Date.UTC(
      since.getUTCFullYear(),
      since.getUTCMonth(),
      since.getUTCDate(),
    ),
  );
  while (cursor.getTime() <= until.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Token/cost usage dashboard for the harness: KPI tiles plus per-day and
 * per-agent charts, filterable by agent kind and time range. Cost renders
 * only when the provider has per-MTok prices configured.
 */
export function HarnessUsage() {
  const { t } = useTranslation();
  const formatDuration = useFormatDuration();
  const [kind, setKind] = React.useState<string>(ALL_VALUE);
  const [rangeDays, setRangeDays] = React.useState<string>("30");
  const [data, setData] = React.useState<AgentUsageResponseDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [theme, setTheme] = React.useState<ThemeColors>(resolveThemeColors);

  React.useEffect(() => {
    const observer = new MutationObserver(() => setTheme(resolveThemeColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, []);

  const sinceRef = React.useMemo(() => {
    const days = Number(rangeDays);
    return new Date(Date.now() - days * 24 * 3600 * 1000);
  }, [rangeDays]);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    api.autopilot
      .autopilotControllerGetUsage({
        ...(kind !== ALL_VALUE ? { agentKind: kind } : {}),
        since: sinceRef.toISOString(),
      })
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {
        // transient — keep the previous data
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, sinceRef]);

  const kindLabel = React.useCallback(
    (k: string) => t(`harness.kinds.${k}` as TranslationKey),
    [t],
  );

  const days = React.useMemo(
    () => enumerateDays(sinceRef, new Date()),
    [sinceRef],
  );

  // ── Per-day input/output series (respecting the agent filter) ──
  const perDay = React.useMemo(() => {
    const input = new Map<string, number>();
    const output = new Map<string, number>();
    const cost = new Map<string, number>();
    for (const b of data?.buckets ?? []) {
      input.set(b.date, (input.get(b.date) ?? 0) + b.inputTokens);
      output.set(b.date, (output.get(b.date) ?? 0) + b.outputTokens);
      if (b.costUsd != null)
        cost.set(b.date, (cost.get(b.date) ?? 0) + b.costUsd);
    }
    return {
      input: days.map((d) => input.get(d) ?? 0),
      output: days.map((d) => output.get(d) ?? 0),
      cost: days.map((d) => cost.get(d) ?? 0),
      hasCost: cost.size > 0,
    };
  }, [data, days]);

  // ── Per-agent totals (identity via y-axis labels, not color alone) ──
  const perAgent = React.useMemo(() => {
    const input = new Map<string, number>();
    const output = new Map<string, number>();
    for (const b of data?.buckets ?? []) {
      input.set(b.agentKind, (input.get(b.agentKind) ?? 0) + b.inputTokens);
      output.set(b.agentKind, (output.get(b.agentKind) ?? 0) + b.outputTokens);
    }
    const kinds = AGENT_KINDS.filter(
      (k) => (input.get(k) ?? 0) + (output.get(k) ?? 0) > 0,
    );
    return {
      kinds,
      input: kinds.map((k) => input.get(k) ?? 0),
      output: kinds.map((k) => output.get(k) ?? 0),
    };
  }, [data]);

  const mode = theme.dark ? "dark" : "light";
  const axis = {
    axisLine: { lineStyle: { color: theme.border } },
    axisLabel: { color: theme.mutedForeground, fontSize: 10 },
  };
  const splitLine = { lineStyle: { color: theme.border, opacity: 0.6 } };
  const dayLabels = days.map((d) => d.slice(5));

  const tokensPerDayOption = React.useMemo(
    () => ({
      grid: { left: 12, right: 12, top: 34, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis" as const },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: theme.mutedForeground, fontSize: 11 },
      },
      xAxis: { type: "category" as const, data: dayLabels, ...axis },
      yAxis: {
        type: "value" as const,
        splitLine,
        axisLabel: {
          color: theme.mutedForeground,
          fontSize: 10,
          formatter: (v: number) => formatTokens(v),
        },
      },
      series: [
        {
          name: t("harness.usage.seriesInput"),
          type: "bar" as const,
          stack: "tokens",
          data: perDay.input,
          itemStyle: { color: INPUT_COLOR[mode] },
          barMaxWidth: 22,
        },
        {
          name: t("harness.usage.seriesOutput"),
          type: "bar" as const,
          stack: "tokens",
          data: perDay.output,
          itemStyle: {
            color: OUTPUT_COLOR[mode],
            borderRadius: [3, 3, 0, 0],
          },
          barMaxWidth: 22,
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perDay, dayLabels.join(","), theme, t],
  );

  const tokensByAgentOption = React.useMemo(
    () => ({
      grid: { left: 12, right: 24, top: 34, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis" as const },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: theme.mutedForeground, fontSize: 11 },
      },
      xAxis: {
        type: "value" as const,
        splitLine,
        axisLabel: {
          color: theme.mutedForeground,
          fontSize: 10,
          formatter: (v: number) => formatTokens(v),
        },
      },
      yAxis: {
        type: "category" as const,
        data: perAgent.kinds.map((k) => kindLabel(k)),
        ...axis,
      },
      series: [
        {
          name: t("harness.usage.seriesInput"),
          type: "bar" as const,
          stack: "tokens",
          data: perAgent.input,
          itemStyle: { color: INPUT_COLOR[mode] },
          barMaxWidth: 18,
        },
        {
          name: t("harness.usage.seriesOutput"),
          type: "bar" as const,
          stack: "tokens",
          data: perAgent.output,
          itemStyle: {
            color: OUTPUT_COLOR[mode],
            borderRadius: [0, 3, 3, 0],
          },
          barMaxWidth: 18,
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perAgent, theme, t, kindLabel],
  );

  const costPerDayOption = React.useMemo(
    () => ({
      grid: { left: 12, right: 12, top: 12, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis" as const,
        valueFormatter: (v: unknown) =>
          typeof v === "number" ? formatCost(v) : String(v),
      },
      xAxis: { type: "category" as const, data: dayLabels, ...axis },
      yAxis: {
        type: "value" as const,
        splitLine,
        axisLabel: {
          color: theme.mutedForeground,
          fontSize: 10,
          formatter: (v: number) => formatCost(v),
        },
      },
      series: [
        {
          name: t("harness.usage.costPerDay"),
          type: "bar" as const,
          data: perDay.cost,
          itemStyle: {
            color: AGENT_COLORS.CASE?.[mode],
            borderRadius: [3, 3, 0, 0],
          },
          barMaxWidth: 22,
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perDay, dayLabels.join(","), theme, t],
  );

  const totals = data?.totals;
  const hasAny = (totals?.runs ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="h-9 w-[190px] rounded-[4px] border-2 border-border font-mono text-xs uppercase tracking-wide">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>
              {t("harness.usage.filters.allAgents")}
            </SelectItem>
            {AGENT_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: AGENT_COLORS[k]?.[mode] }}
                  />
                  {kindLabel(k)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={rangeDays} onValueChange={setRangeDays}>
          <SelectTrigger className="h-9 w-[150px] rounded-[4px] border-2 border-border font-mono text-xs uppercase tracking-wide">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{t("harness.usage.filters.range7")}</SelectItem>
            <SelectItem value="30">{t("harness.usage.filters.range30")}</SelectItem>
            <SelectItem value="90">{t("harness.usage.filters.range90")}</SelectItem>
          </SelectContent>
        </Select>
        {loading && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* ── KPI tiles ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <UsageKpi
          label={t("harness.usage.kpi.runs")}
          value={totals ? String(totals.runs) : "—"}
        />
        <UsageKpi
          label={t("harness.usage.kpi.inputTokens")}
          value={totals ? formatTokens(totals.inputTokens) : "—"}
        />
        <UsageKpi
          label={t("harness.usage.kpi.outputTokens")}
          value={totals ? formatTokens(totals.outputTokens) : "—"}
        />
        <UsageKpi
          label={t("harness.usage.kpi.avgDuration")}
          value={
            totals?.avgDurationMs != null
              ? formatDuration(totals.avgDurationMs)
              : "—"
          }
        />
        <UsageKpi
          label={t("harness.usage.kpi.cost")}
          value={totals?.costUsd != null ? formatCost(totals.costUsd) : "—"}
          accent={totals?.costUsd != null}
        />
      </div>

      {!hasAny && !loading ? (
        <p className="rounded-[4px] border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t("harness.usage.empty")}
        </p>
      ) : (
        <>
          {/* ── Tokens per day ── */}
          <ChartPanel title={t("harness.usage.tokensPerDay")}>
            <EChartBox option={tokensPerDayOption} className="h-[280px]" />
          </ChartPanel>

          {/* ── Tokens by agent ── */}
          {kind === ALL_VALUE && perAgent.kinds.length > 0 && (
            <ChartPanel title={t("harness.usage.tokensByAgent")}>
              <EChartBox
                option={tokensByAgentOption}
                className="h-[240px]"
              />
            </ChartPanel>
          )}

          {/* ── Cost per day ── */}
          {perDay.hasCost ? (
            <ChartPanel title={t("harness.usage.costPerDay")}>
              <EChartBox option={costPerDayOption} className="h-[240px]" />
            </ChartPanel>
          ) : (
            data &&
            !data.pricingConfigured && (
              <p className="flex items-center gap-2 rounded-[4px] border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
                <Coins className="h-3.5 w-3.5 shrink-0" />
                {t("harness.usage.noPricing")}
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

function UsageKpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[4px] border-2 px-3 py-2",
        accent
          ? "border-[#d97706]/50 bg-[#d97706]/[0.06]"
          : "border-border bg-card",
      )}
    >
      <p className="font-serif text-xl font-black tabular-nums leading-none">
        {value}
      </p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function ChartPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[4px] border-2 border-border bg-card px-4 py-3">
      <h3 className="mb-2 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}
