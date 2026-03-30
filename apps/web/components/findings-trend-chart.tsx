"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { format } from "date-fns";
import { cn } from "@workspace/ui/lib/utils";

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
  label: string;
  color: string;
}> = [
  { key: "critical", label: "Critical", color: "#DC2626" },
  { key: "high", label: "High", color: "#EA580C" },
  { key: "medium", label: "Medium", color: "#CA8A04" },
  { key: "low", label: "Low", color: "#3B82F6" },
  { key: "info", label: "Info", color: "#6B7280" },
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

  const { labels, series } = useMemo(() => {
    const dayLabels = timeline.map((bucket) => formatLabel(bucket.date));
    const seriesData = severityConfig.map((severity) => ({
      name: severity.label,
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
  }, [timeline]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.setOption(
      {
        grid: {
          left: 12,
          right: 12,
          top: 36,
          bottom: 12,
          containLabel: true,
        },
        tooltip: {
          trigger: "axis",
        },
        legend: {
          top: 0,
          left: 0,
        },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: labels,
          axisLine: { lineStyle: { color: "#CBD5F5" } },
          axisLabel: { color: "#64748B", fontSize: 11 },
        },
        yAxis: {
          type: "value",
          axisLabel: { color: "#64748B", fontSize: 11 },
          splitLine: { lineStyle: { color: "#E2E8F0" } },
        },
        series,
      },
      { notMerge: true },
    );
  }, [labels, series]);

  return (
    <div ref={containerRef} className={cn("h-[320px] w-full", className)} />
  );
}
