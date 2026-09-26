"use client";

import * as React from "react";
import { EdgeLabelRenderer } from "@xyflow/react";
import { cn } from "@workspace/ui/lib/utils";

/**
 * A label or hover card pinned to a point on an edge. Rendered through
 * EdgeLabelRenderer (HTML above the SVG), so it is crisp at any zoom and can
 * take clicks without the pane stealing them.
 */
export function EdgeLabel({
  x,
  y,
  children,
  className,
  interactive = false,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <EdgeLabelRenderer>
      <div
        className={cn(
          "nodrag nopan absolute rounded-[3px] border border-border bg-card px-1.5 py-0.5 text-[11px] leading-tight text-card-foreground",
          className,
        )}
        style={{
          transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
          pointerEvents: interactive ? "all" : "none",
        }}
      >
        {children}
      </div>
    </EdgeLabelRenderer>
  );
}

/**
 * The old graph's edge text: small mono capitals lying along the edge, kept
 * upright, with a background halo instead of a box, just above the line.
 */
export function EdgeText({
  x,
  y,
  angle,
  children,
  className,
}: {
  x: number;
  y: number;
  angle: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <EdgeLabelRenderer>
      <div
        className={cn(
          "cb-edge-text nodrag nopan pointer-events-none absolute flex items-center gap-1 whitespace-nowrap font-mono text-[9px] uppercase leading-none tracking-[0.06em] text-muted-foreground",
          className,
        )}
        style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${angle}deg) translateY(-7px)` }}
      >
        {children}
      </div>
    </EdgeLabelRenderer>
  );
}
