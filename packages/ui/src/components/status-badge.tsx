import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { STATUS_TONE, statusBadgeClass } from "../lib/status-tone";
import { CheckCircle2, AlertCircle, XCircle, Clock } from "lucide-react";

/**
 * A finding's review state.
 *
 * Borderless tinted rectangles here, bordered pills everywhere else, made two
 * status columns in the SAME table (assets: "Status" and "Review mix") look
 * like unrelated widgets. These now wear `statusBadgeClass` and draw their
 * colour from the shared tone scale, so a finding's OPEN and a case's OPEN are
 * finally the same green.
 */
const statusBadgeVariants = cva(
  `inline-flex items-center gap-1 px-2 py-0.5 ${statusBadgeClass}`,
  {
    variants: {
      status: {
        new: STATUS_TONE.progress,
        open: STATUS_TONE.active,
        resolved: STATUS_TONE.done,
        false_positive: STATUS_TONE.idle,
        ignored: STATUS_TONE.archived,
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
