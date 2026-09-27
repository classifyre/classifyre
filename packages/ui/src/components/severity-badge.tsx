import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { FINDING_SEVERITY_INK } from "../lib/finding-severity";
import { cn } from "../lib/utils";

/**
 * Severity keeps its own hues — it is a scale, not a state, and the colours are
 * the same ones the canvas and the charts use. What it shares with the status
 * pills is the chrome: same radius, same border weight, same type, so a row
 * carrying both does not look assembled from two design systems.
 */
const severityBadgeVariants = cva(
  "inline-flex items-center rounded-[4px] border bg-transparent px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] shadow-none transition-colors",
  {
    variants: {
      // The light-mode hues are dark inks meant for a white card; on the dark
      // card they measure 2.8:1 (low) to 3.9:1 (info) — the whole scale sits
      // under AA. Each gets a lifted twin, same hue, ~7:1 on #121212.
      severity: {
        critical: `border-[#b91c1c]/20 font-bold dark:border-[#f87171]/30 ${FINDING_SEVERITY_INK.critical}`,
        high: `border-[#c2410c]/20 font-semibold dark:border-[#fb923c]/30 ${FINDING_SEVERITY_INK.high}`,
        medium: `border-[#a16207]/20 font-semibold dark:border-[#fbbf24]/30 ${FINDING_SEVERITY_INK.medium}`,
        low: `border-[#1d4ed8]/20 font-medium dark:border-[#60a5fa]/30 ${FINDING_SEVERITY_INK.low}`,
        info: `border-[#78716c]/20 font-medium dark:border-[#a8a29e]/30 ${FINDING_SEVERITY_INK.info}`,
      },
    },
    defaultVariants: {
      severity: "info",
    },
  },
);

export interface SeverityBadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof severityBadgeVariants> {}

function SeverityBadge({ className, severity, ...props }: SeverityBadgeProps) {
  return (
    <div
      className={cn(severityBadgeVariants({ severity }), className)}
      {...props}
    />
  );
}

export { SeverityBadge, severityBadgeVariants };
