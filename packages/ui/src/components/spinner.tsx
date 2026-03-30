import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { Loader2 } from "lucide-react";

const spinnerVariants = cva("animate-spin", {
  variants: {
    size: {
      sm: "h-4 w-4",
      md: "h-6 w-6",
      lg: "h-8 w-8",
      xl: "h-12 w-12",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export interface SpinnerProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof spinnerVariants> {
  label?: string;
}

function Spinner({ className, size, label, ...props }: SpinnerProps) {
  return (
    <div
      className={cn("flex items-center gap-2", className)}
      role="status"
      aria-label={label || "Loading"}
      {...props}
    >
      <Loader2 className={cn(spinnerVariants({ size }))} />
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </div>
  );
}

export { Spinner, spinnerVariants };
