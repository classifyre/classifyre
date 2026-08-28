import type { CSSProperties, ReactNode } from "react";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The surface every dashboard panel sits on.
 *
 * Extracted from the discovery page so the review queue uses the same card
 * rather than a near-copy — two definitions of "a panel" drift within a
 * release, and the difference reads as sloppiness rather than as design.
 */
export const panelCardBaseClass =
  "min-w-0 rounded-[10px] panel-card bg-card p-4 sm:p-6 text-card-foreground";

/** Inset well inside a panel: a stat, a value, a secondary grouping. */
export const panelInsetCardClass =
  "rounded-[4px] border-2 border-border bg-background px-3 py-2";

/** Uppercase mono micro-label. The quietest text in the system. */
export const microLabelClass =
  "text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-mono";

/** Section heading: serif, black, tight tracking. */
export const panelHeadingClass =
  "font-serif text-lg font-black uppercase tracking-[0.06em] text-foreground";

export function PanelCard({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={cn(panelCardBaseClass, className)} style={style}>
      {children}
    </div>
  );
}
