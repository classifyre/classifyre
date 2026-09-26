"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import { useTranslation } from "@/hooks/use-translation";
import { useBoardStore, useUiStore } from "../store/board-context";
import { addFrame } from "../store/commands";

/**
 * The Frame tool (F): drag a rectangle to create a frame, then name it. A
 * plain overlay rather than React Flow's selection box, which cannot report
 * the rectangle it drew.
 */
export function FrameDrawOverlay() {
  const { t } = useTranslation();
  const rf = useReactFlow();
  const store = useBoardStore();
  const ui = useUiStore();
  const [drag, setDrag] = React.useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const hostRef = React.useRef<HTMLDivElement>(null);

  const local = (e: React.PointerEvent) => {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 z-10 cursor-crosshair"
      role="presentation"
      aria-label={t("caseBoard.tools.frameHint")}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const p = local(e);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = local(e);
        setDrag({ ...drag, x1: p.x, y1: p.y });
      }}
      onPointerUp={(e) => {
        if (!drag) return;
        const r = hostRef.current!.getBoundingClientRect();
        const a = rf.screenToFlowPosition({ x: r.left + Math.min(drag.x0, drag.x1), y: r.top + Math.min(drag.y0, drag.y1) });
        const b = rf.screenToFlowPosition({ x: r.left + Math.max(drag.x0, drag.x1), y: r.top + Math.max(drag.y0, drag.y1) });
        setDrag(null);
        const width = b.x - a.x;
        const height = b.y - a.y;
        // A click without a drag makes a default-sized frame there.
        const tiny = width < 20 || height < 20;
        const cmd = addFrame({ x: a.x, y: a.y, width: tiny ? 640 : width, height: tiny ? 400 : height });
        store.getState().run(cmd);
        ui.getState().set({ tool: "select", editingItemId: cmd.id });
        e.stopPropagation();
      }}
    >
      {drag && (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-foreground bg-foreground/5"
          style={{
            left: Math.min(drag.x0, drag.x1),
            top: Math.min(drag.y0, drag.y1),
            width: Math.abs(drag.x1 - drag.x0),
            height: Math.abs(drag.y1 - drag.y0),
          }}
        />
      )}
    </div>
  );
}
