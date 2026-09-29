"use client";

// The board's colour tokens (--cb-*): a card may be drawn before any board
// was opened in this tab.
import "@workspace/case-board/board.css";

import * as React from "react";
import { useTheme } from "next-themes";
import type { BoardSketch } from "@workspace/schemas/case-board";
import { cn } from "@workspace/ui/lib/utils";
import { drawBoardSketch, readSketchPalette } from "./board-sketch";

/**
 * A board sketch on a canvas that fills its parent, redrawn when the parent
 * resizes or the theme flips. One canvas per card instead of an SVG node per
 * shape: a page of cards stays a page of elements, not tens of thousands.
 */
export function BoardSketchCanvas({
  sketch,
  label,
  className,
}: {
  sketch: BoardSketch;
  /** What a screen reader hears for the picture. */
  label: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let frame = 0;
    const draw = () => {
      cancelAnimationFrame(frame);
      // Next frame: the theme class is on <html> by then, and a burst of
      // resizes draws once.
      frame = requestAnimationFrame(() => {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (width < 1 || height < 1) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.round(width * dpr);
        const h = Math.round(height * dpr);
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBoardSketch(ctx, sketch, width, height, readSketchPalette(canvas));
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [sketch, resolvedTheme]);

  return <canvas ref={ref} role="img" aria-label={label} className={cn("block size-full", className)} />;
}
