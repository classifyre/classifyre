"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import type * as echarts from "echarts";
import type { SourceCoverageDto } from "@workspace/api-client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
import { EChartBox } from "@/components/echart-box";
import { useTranslation } from "@/hooks/use-translation";
import { useChartTheme } from "@/hooks/use-chart-theme";
import { clickedIndex } from "./chart-click";

const MAX_SOURCES = 12;

/**
 * How far each source is governed: certified, owned but not yet certified,
 * and nobody's. Clicking a source narrows the whole tab to it.
 */
export function CoverageChartCard({
  coverage,
  selected,
  onSelect,
}: {
  coverage: SourceCoverageDto[];
  selected: string | null;
  onSelect: (sourceId: string | null) => void;
}) {
  const { t } = useTranslation();
  const theme = useChartTheme();
  const rows = useMemo(
    () => coverage.filter((row) => row.assets > 0).slice(0, MAX_SOURCES),
    [coverage],
  );

  const option = useMemo<echarts.EChartsCoreOption>(() => {
    const series = (
      name: string,
      color: string,
      value: (row: SourceCoverageDto) => number,
    ) => ({
      name,
      type: "bar",
      stack: "coverage",
      cursor: "pointer",
      color,
      barMaxWidth: 22,
      data: rows.map((row) => ({
        value: value(row),
        itemStyle: {
          opacity: selected && selected !== row.sourceId ? 0.35 : 1,
        },
      })),
    });
    return {
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: theme.mutedForeground, fontSize: 11 },
      },
      xAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: theme.mutedForeground, fontSize: 10 },
        splitLine: { lineStyle: { color: theme.border } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        triggerEvent: true,
        data: rows.map((row) => row.name),
        axisLabel: {
          width: 180,
          overflow: "truncate",
          fontSize: 11,
          color: theme.mutedForeground,
        },
      },
      series: [
        series(
          t("assets.governance.coverage.certified"),
          theme.positive,
          (row) => row.certified,
        ),
        series(
          t("assets.governance.coverage.owned"),
          theme.info,
          (row) => row.owned - row.certified,
        ),
        series(
          t("assets.governance.coverage.ungoverned"),
          theme.quiet,
          (row) => row.assets - row.owned,
        ),
      ],
    };
  }, [rows, selected, theme, t]);

  if (!rows.length) return null;

  return (
    <Card className="panel-card rounded-[6px]" data-testid="coverage-card">
      <CardHeader className="flex flex-col gap-2 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-sm uppercase tracking-[0.08em]">
            {t("assets.governance.coverage.title")}
          </CardTitle>
          <CardDescription>
            {t("assets.governance.coverage.lead")}
          </CardDescription>
        </div>
        {selected && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSelect(null)}
            className="shrink-0"
          >
            <X className="size-3.5" aria-hidden />
            {t("assets.governance.coverage.clear")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <EChartBox
          option={option}
          className="w-full"
          style={{ height: Math.max(140, rows.length * 32 + 48) }}
          onChartClick={(event) => {
            const index = clickedIndex(
              event,
              rows.map((row) => row.name),
            );
            const target = rows[index];
            if (target)
              onSelect(target.sourceId === selected ? null : target.sourceId);
          }}
        />
      </CardContent>
    </Card>
  );
}
