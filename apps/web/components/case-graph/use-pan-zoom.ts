"use client";

import * as React from "react";

export interface Transform {
  x: number;
  y: number;
  k: number;
}

const MIN_K = 0.1;
const MAX_K = 4;

interface UsePanZoomResult {
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** Attach to the root <g> that holds the whole scene. */
  gRef: React.RefObject<SVGGElement | null>;
  transformRef: React.RefObject<Transform>;
  screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** Fit a world-space bbox into the viewport. */
  fitBBox: (bbox: { x: number; y: number; w: number; h: number }) => void;
  /** Start a background pan from a pointerdown event. Returns false if ignored. */
  beginPan: (e: React.PointerEvent) => void;
}

export function usePanZoom(): UsePanZoomResult {
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const gRef = React.useRef<SVGGElement | null>(null);
  const transformRef = React.useRef<Transform>({ x: 0, y: 0, k: 1 });

  const apply = React.useCallback(() => {
    const t = transformRef.current;
    gRef.current?.setAttribute("transform", `translate(${t.x},${t.y}) scale(${t.k})`);
  }, []);

  // Wheel zoom must be a non-passive native listener (React's is passive).
  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;
      // ctrl+wheel is trackpad pinch — same gesture, finer delta handling.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const k2 = Math.min(MAX_K, Math.max(MIN_K, t.k * factor));
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      t.x = px - ((px - t.x) / t.k) * k2;
      t.y = py - ((py - t.y) / t.k) * k2;
      t.k = k2;
      apply();
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [apply]);

  const screenToWorld = React.useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const t = transformRef.current;
    const rect = svg?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k,
    };
  }, []);

  const fitBBox = React.useCallback(
    (bbox: { x: number; y: number; w: number; h: number }) => {
      const svg = svgRef.current;
      if (!svg || bbox.w <= 0 || bbox.h <= 0) return;
      const rect = svg.getBoundingClientRect();
      const k = Math.min(MAX_K, Math.max(MIN_K, Math.min(rect.width / bbox.w, rect.height / bbox.h)));
      const t = transformRef.current;
      t.k = k;
      t.x = (rect.width - bbox.w * k) / 2 - bbox.x * k;
      t.y = (rect.height - bbox.h * k) / 2 - bbox.y * k;
      apply();
    },
    [apply],
  );

  const beginPan = React.useCallback(
    (e: React.PointerEvent) => {
      const svg = svgRef.current;
      if (!svg) return;
      const start = { x: e.clientX, y: e.clientY };
      const orig = { ...transformRef.current };
      const onMove = (ev: PointerEvent) => {
        transformRef.current.x = orig.x + (ev.clientX - start.x);
        transformRef.current.y = orig.y + (ev.clientY - start.y);
        apply();
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [apply],
  );

  return { svgRef, gRef, transformRef, screenToWorld, fitBBox, beginPan };
}
