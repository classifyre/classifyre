"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { format } from "date-fns";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

type SeverityKey = "critical" | "high" | "medium" | "low" | "info";

type TimelineBucket = {
  date: string;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
};

const severityConfig: Array<{
  key: SeverityKey;
  labelKey: TranslationKey;
  color: string;
}> = [
  { key: "critical", labelKey: "findings.severityLabels.CRITICAL", color: "#DC2626" },
  { key: "high", labelKey: "findings.severityLabels.HIGH", color: "#EA580C" },
  { key: "medium", labelKey: "findings.severityLabels.MEDIUM", color: "#CA8A04" },
  { key: "low", labelKey: "findings.severityLabels.LOW", color: "#3B82F6" },
  { key: "info", labelKey: "findings.severityLabels.INFO", color: "#6B7280" },
];

function buildGradient(color: string) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: `${color}55` },
    { offset: 1, color: `${color}05` },
  ]);
}

function formatLabel(dateKey: string) {
  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return format(parsed, "MMM d");
}

export function FindingsTrendChart({
  timeline,
  className,
}: {
  timeline: TimelineBucket[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  const { t } = useTranslation();
  const themeRef = useRef<HTMLDivElement | null>(null);

  const { labels, series } = useMemo(() => {
    const dayLabels = timeline.map((bucket) => formatLabel(bucket.date));
    const seriesData = severityConfig.map((severity) => ({
      name: t(severity.labelKey),
      type: "line" as const,
      smooth: true,
      showSymbol: false,
      stack: "total",
      lineStyle: { width: 2, color: severity.color },
      areaStyle: { color: buildGradient(severity.color) },
      emphasis: { focus: "series" as const },
      data: timeline.map((bucket) => bucket[severity.key]),
    }));

    return { labels: dayLabels, series: seriesData };
  }, [timeline, t]);

  function readCSSVar(name: string, fallback: string) {
    if (!themeRef.current) return fallback;
    return getComputedStyle(themeRef.current).getPropertyValue(name).trim() || fallback;
  }

  function buildChartOption() {
    const axisLabelColor = readCSSVar("--muted-foreground", "#64748B");
    const axisLineColor = readCSSVar("--border", "#CBD5F5");
    const splitLineColor = readCSSVar("--border", "#E2E8F0");

    return {
      grid: {
        left: 12,
        right: 12,
        top: 36,
        bottom: 12,
        containLabel: true,
      },
      tooltip: {
        trigger: "axis" as const,
      },
      legend: {
        top: 0,
        left: 0,
        textStyle: { color: axisLabelColor },
      },
      xAxis: {
        type: "category" as const,
        boundaryGap: false,
        data: labels,
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: { color: axisLabelColor, fontSize: 11 },
      },
      yAxis: {
        type: "value" as const,
        axisLabel: { color: axisLabelColor, fontSize: 11 },
        splitLine: { lineStyle: { color: splitLineColor } },
      },
      series,
    };
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(containerRef.current);

    const themeObserver = new MutationObserver(() => {
      chart.setOption(buildChartOption(), { notMerge: true });
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.setOption(buildChartOption(), { notMerge: true });
  }, [labels, series]);

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        themeRef.current = el;
      }}
      className={cn("h-[320px] w-full", className)}
    />
  );
}
