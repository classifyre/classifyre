"use client";

import * as React from "react";
import { cn } from "@workspace/ui/lib/utils";

/**
 * One harness KPI tile — the shared cell used by the mission-control stat
 * strip and the usage dashboard, so the two rows on the same screen never
 * drift apart visually.
 */
export function HarnessStatTile({
  label,
  value,
  accent = "none",
  pulse = false,
}: {
  label: string;
  value: React.ReactNode;
  /** Highlight variant: emerald (live activity) or amber (cost/attention). */
  accent?: "none" | "emerald" | "amber";
  /** Show the animated live dot next to the value (emerald accent only). */
  pulse?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[4px] border-2 px-3 py-2",
        accent === "emerald" && "border-emerald-500/50 bg-emerald-500/[0.06]",
        accent === "amber" && "border-[#d97706]/50 bg-[#d97706]/[0.06]",
        accent === "none" && "border-border bg-card",
      )}
    >
      <div className="flex items-center gap-1.5">
        {pulse && (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        )}
        <p className="font-serif text-xl font-black tabular-nums leading-none">
          {value}
        </p>
      </div>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
