"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";

/** The middle of the visible canvas, in board coordinates: where placed things land. */
export function useVisibleCentre(): () => { x: number; y: number } {
  const rf = useReactFlow();
  return React.useCallback(() => {
    const pane = document.querySelector<HTMLElement>(".case-board .react-flow");
    const rect = pane?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [rf]);
}
