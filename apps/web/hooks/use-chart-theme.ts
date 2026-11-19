"use client";

import * as React from "react";

export type ChartTheme = {
  mutedForeground: string;
  border: string;
  dark: boolean;
  foreground: string;
  /** Good news (passing, certified): the accent, readable on this theme. */
  positive: string;
  /** The brand accent itself (acid green): fills, never text. */
  accent: string;
  /** Bad news (failing): the destructive red. */
  negative: string;
  /** A neutral second series (exports, owned): the sky chart colour. */
  info: string;
  /** What is not there yet (ungoverned): a quiet grey. */
  quiet: string;
};

const DEFAULT_THEME: ChartTheme = {
  mutedForeground: "#64748B",
  border: "#CBD5F5",
  dark: false,
  foreground: "#0a0a0a",
  positive: "#4d6b00",
  accent: "#b7ff00",
  negative: "#ff2b2b",
  info: "#0ea5e9",
  quiet: "#7c7c7c",
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
    foreground: read("--foreground", DEFAULT_THEME.foreground),
    positive: read("--accent-ink", DEFAULT_THEME.positive),
    accent: read("--accent", DEFAULT_THEME.accent),
    negative: read("--chart-2", DEFAULT_THEME.negative),
    info: read("--chart-4", DEFAULT_THEME.info),
    quiet: read("--chart-5", DEFAULT_THEME.quiet),
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
