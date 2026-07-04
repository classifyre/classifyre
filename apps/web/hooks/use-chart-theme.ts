"use client";

import * as React from "react";

export type ChartTheme = {
  mutedForeground: string;
  border: string;
  dark: boolean;
};

const DEFAULT_THEME: ChartTheme = {
  mutedForeground: "#64748B",
  border: "#CBD5F5",
  dark: false,
};

function resolveChartTheme(): ChartTheme {
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

/**
 * Chart-facing theme tokens resolved from the design-system CSS variables,
 * re-resolved whenever the root element's class/style changes (dark-mode
 * toggle). One canonical copy of the pattern used by the ECharts surfaces.
 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = React.useState<ChartTheme>(resolveChartTheme);

  React.useEffect(() => {
    const observer = new MutationObserver(() => setTheme(resolveChartTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}
