import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { CheckCircle2, AlertCircle, XCircle, Clock } from "lucide-react";

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      status: {
        new: "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
        open: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
        resolved:
          "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
        false_positive:
          "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400",
        ignored:
          "bg-stone-50 text-stone-400 dark:bg-stone-800/50 dark:text-stone-500",
      },
    },
    defaultVariants: {
      status: "open",
    },
  },
);

const statusIcons = {
  new: AlertCircle,
  open: Clock,
  resolved: CheckCircle2,
  false_positive: XCircle,
  ignored: XCircle,
};

export interface StatusBadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statusBadgeVariants> {
  showIcon?: boolean;
}

function StatusBadge({
  className,
  status,
  showIcon = true,
  children,
  ...props
}: StatusBadgeProps) {
  const Icon = status ? statusIcons[status] : null;

  return (
    <div className={cn(statusBadgeVariants({ status }), className)} {...props}>
      {showIcon && Icon && <Icon className="h-3 w-3" />}
      {children}
    </div>
  );
}

export { StatusBadge, statusBadgeVariants };
