import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const severityBadgeVariants = cva(
  "inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] uppercase tracking-wide transition-colors border bg-transparent",
  {
    variants: {
      severity: {
        critical: "text-[#b91c1c] border-[#b91c1c]/20 font-bold",
        high: "text-[#c2410c] border-[#c2410c]/20 font-semibold",
        medium: "text-[#a16207] border-[#a16207]/20 font-semibold",
        low: "text-[#1d4ed8] border-[#1d4ed8]/20 font-medium",
        info: "text-[#78716c] border-[#78716c]/20 font-medium",
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
