"use client";

import { useInternalNode } from "@xyflow/react";
import { getAnchoredParams, type AnchoredParams } from "../lib/anchor";

export interface EdgeGeometry extends AnchoredParams {
  path: string;
  labelX: number;
  labelY: number;
  /** Degrees along the edge, flipped where needed so a label never reads upside down. */
  angle: number;
  /** Length in flow units, to skip labels on edges too short to carry one. */
  length: number;
}

/** How far a parallel edge bows out per step. */
const BOW = 26;

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Anchored geometry for an edge between two nodes, drawn straight as the old
 * case graph drew it; parallel edges between one pair bow apart (`bend`).
 * Returns null until both nodes are measured.
 */
export function useEdgeGeometry(source: string, target: string, bend = 0): EdgeGeometry | null {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t || !s.measured.width || !t.measured.width) return null;
  const p = getAnchoredParams(s, t);
  const dx = p.tx - p.sx;
  const dy = p.ty - p.sy;
  const length = Math.hypot(dx, dy) || 1;
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;
  if (!bend) {
    return {
      ...p,
      path: `M${r1(p.sx)},${r1(p.sy)} L${r1(p.tx)},${r1(p.ty)}`,
      labelX: (p.sx + p.tx) / 2,
      labelY: (p.sy + p.ty) / 2,
      angle,
      length,
    };
  }
  const off = bend * BOW;
  const cx = (p.sx + p.tx) / 2 - (dy / length) * off;
  const cy = (p.sy + p.ty) / 2 + (dx / length) * off;
  return {
    ...p,
    path: `M${r1(p.sx)},${r1(p.sy)} Q${r1(cx)},${r1(cy)} ${r1(p.tx)},${r1(p.ty)}`,
    // The label sits on the curve, not on the chord.
    labelX: (p.sx + 2 * cx + p.tx) / 4,
    labelY: (p.sy + 2 * cy + p.ty) / 4,
    angle,
    length,
  };
}
