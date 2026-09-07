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

/**
 * The last row of a stat card.
 *
 * Every hero card ends with a line of bookkeeping — the review-state mix, which
 * severity is currently highest, where the numbers came from. Three cards had
 * three different versions of that row (different top margins, rules, sizes),
 * which read as three unrelated panels stacked in a grid. This is the one
 * definition: a hairline rule, one dense mono line, no vertical drift.
 *
 * `separated` draws the rule; a card whose footnote sits directly under a
 * bordered block passes false.
 */
export function CardFootnote({
  className,
  tone = "muted",
  separated = true,
  children,
}: {
  className?: string;
  /** `muted` on a light panel, `inverted` on the dark accent panel. */
  tone?: "muted" | "inverted";
  separated?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase leading-[1.35] tracking-[0.12em]",
        separated && "border-t pt-2",
        tone === "inverted"
          ? "border-white/20 text-white/70"
          : "border-border/25 text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The `·` that separates footnote segments. Never wraps onto its own line. */
export function FootnoteDot({ tone = "muted" }: { tone?: "muted" | "inverted" }) {
  return (
    <span
      aria-hidden
      className={tone === "inverted" ? "text-white/35" : "text-muted-foreground/35"}
    >
      ·
    </span>
  );
}
