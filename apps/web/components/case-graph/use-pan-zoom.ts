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
  elementRef: React.RefObject<HTMLElement | null>;
  transformRef: React.RefObject<Transform>;
  /** Monotonic counter bumped on every pan/zoom change. */
  version: number;
  screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** Fit a world-space bbox into the viewport. */
  fitBBox: (bbox: { x: number; y: number; w: number; h: number }) => void;
  /** Start a background pan from a pointerdown event. */
  beginPan: (e: React.PointerEvent) => void;
}

export function usePanZoom(): UsePanZoomResult {
  const elementRef = React.useRef<HTMLElement | null>(null);
  const transformRef = React.useRef<Transform>({ x: 0, y: 0, k: 1 });
  const [version, setVersion] = React.useState(0);

  const bump = React.useCallback(() => setVersion((v) => v + 1), []);

  // Wheel zoom must be a non-passive native listener (React's is passive).
  React.useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const k2 = Math.min(MAX_K, Math.max(MIN_K, t.k * factor));
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      t.x = px - ((px - t.x) / t.k) * k2;
      t.y = py - ((py - t.y) / t.k) * k2;
      t.k = k2;
      bump();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [bump]);

  const screenToWorld = React.useCallback((clientX: number, clientY: number) => {
    const el = elementRef.current;
    const t = transformRef.current;
    const rect = el?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k,
    };
  }, []);

  const fitBBox = React.useCallback(
    (bbox: { x: number; y: number; w: number; h: number }) => {
      const el = elementRef.current;
      if (!el || bbox.w <= 0 || bbox.h <= 0) return;
      const rect = el.getBoundingClientRect();
      const k = Math.min(MAX_K, Math.max(MIN_K, Math.min(rect.width / bbox.w, rect.height / bbox.h)));
      const t = transformRef.current;
      t.k = k;
      t.x = (rect.width - bbox.w * k) / 2 - bbox.x * k;
      t.y = (rect.height - bbox.h * k) / 2 - bbox.y * k;
      bump();
    },
    [bump],
  );

  const beginPan = React.useCallback(
    (e: React.PointerEvent) => {
      const el = elementRef.current;
      if (!el) return;
      const start = { x: e.clientX, y: e.clientY };
      const orig = { ...transformRef.current };
      const onMove = (ev: PointerEvent) => {
        transformRef.current.x = orig.x + (ev.clientX - start.x);
        transformRef.current.y = orig.y + (ev.clientY - start.y);
        bump();
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [bump],
  );

  return { elementRef, transformRef, version, screenToWorld, fitBBox, beginPan };
}
