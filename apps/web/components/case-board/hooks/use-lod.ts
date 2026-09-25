"use client";

import { useStore } from "@xyflow/react";
import { lodOf, type Lod } from "../store/projection";

/**
 * Level of detail from the zoom (PRD §5.2). One narrow subscription per
 * node: it only re-renders when the bucket flips, not on every zoom frame.
 */
export function useLod(): Lod {
  return useStore((s) => lodOf(s.transform[2]));
}

/** True while zoomed in enough for edge labels to be legible. */
export function useLabelsVisible(): boolean {
  return useStore((s) => s.transform[2] >= 0.6);
}
