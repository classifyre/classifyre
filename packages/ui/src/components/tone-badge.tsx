import * as React from "react";
import { cn } from "../lib/utils";
import { Badge } from "./badge";
import { statusBadgeClass, toneClass, type StatusTone } from "../lib/status-tone";

/**
 * A status pill.
 *
 * Every table that shows "what state is this row in" renders one of these, so
 * a runner's RUNNING, an asset's NEW and a case's OPEN are the same object in
 * three different colours rather than three unrelated designs. Pass a tone from
 * the shared scale; do not pass colours.
 */
export interface ToneBadgeProps
  extends Omit<React.ComponentProps<"span">, "children"> {
  tone: StatusTone;
  /** A leading dot, for tones read at a glance down a column. */
  dot?: boolean;
  children?: React.ReactNode;
}

function ToneBadge({ tone, dot = false, className, children, ...props }: ToneBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(statusBadgeClass, toneClass(tone), "gap-1.5", className)}
      {...props}
    >
      {dot && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
        />
      )}
      {children}
    </Badge>
  );
}

export { ToneBadge };
