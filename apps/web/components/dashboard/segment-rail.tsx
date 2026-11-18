"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@workspace/ui/lib/utils";

/** What is not there yet (ungoverned, no rule): a hatch, not a colour. */
export const HATCH: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--foreground) 22%, transparent) 5px 7px)",
};

/**
 * How a governed lifecycle looks on a rail, the same wherever one is drawn
 * (the dashboard's governance brief, the shared datasets' status): certified
 * in the accent, draft dark, deprecated grey, retired pale. Ungoverned is the
 * hatch, apart from all four.
 */
export const LIFECYCLE_LOOK: Record<
  "ACTIVE" | "DRAFT" | "DEPRECATED" | "RETIRED" | "UNGOVERNED",
  Pick<RailSegment, "className" | "style" | "chip">
> = {
  ACTIVE: { className: "bg-accent text-accent-foreground" },
  DRAFT: { className: "bg-foreground text-background" },
  DEPRECATED: { className: "bg-muted-foreground text-background" },
  RETIRED: { className: "bg-muted text-foreground" },
  UNGOVERNED: {
    className: "bg-card text-foreground",
    style: HATCH,
    chip: true,
  },
};

export type RailSegment = {
  key: string;
  label: string;
  count: number;
  /** Fill and text colour, e.g. `bg-accent text-accent-foreground`. */
  className: string;
  style?: CSSProperties;
  /** Opens what the segment counts. */
  href?: string;
  /** A light fill under the percentage, for hatched or busy segments. */
  chip?: boolean;
};

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

/**
 * A whole split into its parts as one bordered bar: each part as wide as its
 * share, its percentage inside when there is room. The dashboard's governance
 * brief and the shared datasets' status both read this way.
 */
export function SegmentRail({
  segments,
  label,
  size = "md",
  testId,
}: {
  segments: RailSegment[];
  label: string;
  size?: "sm" | "md";
  testId?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (total === 0) return null;
  return (
    <div
      className={cn(
        "flex w-full overflow-hidden rounded-[4px] border-2 border-foreground",
        size === "md" ? "h-9" : "h-6",
      )}
      role="group"
      aria-label={label}
      data-testid={testId}
    >
      {segments
        .filter((segment) => segment.count > 0)
        .map((segment, index) => {
          const name = `${segment.count.toLocaleString()} ${segment.label}`;
          const className = cn(
            "flex min-w-[10px] items-center overflow-hidden px-1.5 font-mono text-[11px] font-semibold tabular-nums",
            index > 0 && "border-l-2 border-foreground",
            segment.className,
          );
          const style = { flex: `${segment.count} 1 0`, ...segment.style };
          // A share too thin to hold its number keeps it in the title and the
          // legend instead of a clipped "2.".
          const body =
            size === "md" && segment.count / total >= 0.08 ? (
              <span
                className={cn(
                  "truncate rounded-[2px] px-1",
                  segment.chip && "bg-card text-foreground",
                )}
              >
                {percent(segment.count, total)}%
              </span>
            ) : null;
          return segment.href ? (
            <Link
              key={segment.key}
              href={segment.href}
              title={name}
              aria-label={name}
              className={cn(
                className,
                "transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-accent-ink",
              )}
              style={style}
            >
              {body}
            </Link>
          ) : (
            <span
              key={segment.key}
              title={name}
              role="img"
              aria-label={name}
              className={className}
              style={style}
            >
              {body}
            </span>
          );
        })}
    </div>
  );
}

/** The counts under a rail: swatch, number, label — each a link when it has one. */
export function RailLegend({
  segments,
  testIdPrefix,
  className,
  columns,
}: {
  segments: RailSegment[];
  testIdPrefix?: string;
  className?: string;
  /** Grid columns as classes (wrapping on narrow screens); one row by default. */
  columns?: string;
}) {
  return (
    <div
      className={cn("grid gap-2", columns, className)}
      style={
        columns
          ? undefined
          : {
              gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))`,
            }
      }
    >
      {segments.map((segment) => {
        const body: ReactNode = (
          <>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0 rounded-[2px] border border-foreground",
                  segment.className,
                )}
                style={segment.style}
              />
              <span
                className="text-xl font-bold leading-none sm:text-2xl"
                style={{ fontFamily: "var(--font-hero)" }}
              >
                {segment.count.toLocaleString()}
              </span>
            </span>
            <span className="mt-1 block truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground group-hover:text-foreground">
              {segment.label}
            </span>
          </>
        );
        const testId = testIdPrefix
          ? `${testIdPrefix}-${segment.key}`
          : undefined;
        return segment.href ? (
          <Link
            key={segment.key}
            href={segment.href}
            className="group min-w-0 py-1"
            data-testid={testId}
          >
            {body}
          </Link>
        ) : (
          <div key={segment.key} className="min-w-0 py-1" data-testid={testId}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
