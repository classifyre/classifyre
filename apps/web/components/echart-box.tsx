"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { cn } from "@workspace/ui/lib/utils";

export function EChartBox({
  option,
  className,
  onChartClick,
}: {
  option: echarts.EChartsCoreOption;
  className?: string;
  onChartClick?: (params: unknown) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const clickHandlerRef = useRef<typeof onChartClick>(onChartClick);

  useEffect(() => {
    clickHandlerRef.current = onChartClick;
  }, [onChartClick]);

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
    chartRef.current.setOption(option, {
      notMerge: false,
      lazyUpdate: true,
    });
  }, [option]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;

    const handleClick = (params: unknown) => {
      clickHandlerRef.current?.(params);
    };

    chart.off("click");
    chart.on("click", handleClick);

    return () => {
      chart.off("click", handleClick);
    };
  }, [onChartClick]);

  return (
    <div ref={containerRef} className={cn("h-[320px] w-full", className)} />
  );
}
