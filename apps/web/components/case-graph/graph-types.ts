import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";

export const nodeKey = (type: string, id: string) => `${type}:${id}`;
export const keyOf = (n: GraphNodeDto) => nodeKey(n.type, n.id);

/** d3-force mutable wrapper around a GraphNodeDto. */
export interface SimNode {
  key: string;
  data: GraphNodeDto;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
}

export interface SimEdge {
  id: string;
  data: GraphEdgeDto;
  source: string | SimNode;
  target: string | SimNode;
  index?: number;
}

export type GraphMode =
  | { kind: "select" }
  | { kind: "connect"; sourceKey: string | null }
  | { kind: "path"; firstKey: string | null };

export type GraphSelection =
  | { type: "node"; key: string }
  | { type: "edge"; id: string }
  | null;

export interface PathResult {
  nodeKeys: Set<string>;
  edgeIds: Set<string>;
}

import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";

/** Severity → fill color, shared with the findings table badges. */
export const SEVERITY_COLORS: Record<string, string> = { ...FINDING_SEVERITY_COLOR_BY_ENUM };

/** Black or white text for legibility on a given hex fill. */
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const v = parseInt(m[1]!, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? "#0a0a0a" : "#ffffff";
}

/**
 * Compact category code shown inside finding circles: short names stay full
 * ("PII"), multi-word names become initials ("SENTIMENT_ANALYZER" → "SA"),
 * long single words are clipped ("SECRETS" → "SEC"). CUSTOM detectors use
 * their display name.
 */
export function findingCategoryCode(node: GraphNodeDto): string {
  const custom = node.customDetectorName?.trim();
  const name =
    node.detectorType?.toUpperCase() === "CUSTOM" && custom ? custom : (node.detectorType ?? "");
  const words = name.split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const w = words[0]!;
    return (w.length <= 4 ? w : w.slice(0, 3)).toUpperCase();
  }
  return words
    .map((w) => w[0]!)
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export const MANUAL_EDGE_COLOR = "#d97706";
export const CROSS_HYP_COLOR = "#a855f7";
export const ACCENT = "#b7ff00";

/**
 * Heat colour for a 0..1 similarity strength: sky (weak) → amber → red (strong).
 * Mid-tone stops chosen to read on both the light and dark graph backgrounds.
 */
const STRENGTH_STOPS: Array<{ p: number; c: [number, number, number] }> = [
  { p: 0, c: [56, 189, 248] }, // sky-400
  { p: 0.5, c: [245, 158, 11] }, // amber-500
  { p: 1, c: [239, 68, 68] }, // red-500
];

export function strengthColor(strength: number): string {
  const t = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 0));
  let lo = STRENGTH_STOPS[0]!;
  let hi = STRENGTH_STOPS[STRENGTH_STOPS.length - 1]!;
  for (let i = 0; i < STRENGTH_STOPS.length - 1; i++) {
    const a = STRENGTH_STOPS[i]!;
    const b = STRENGTH_STOPS[i + 1]!;
    if (t >= a.p && t <= b.p) {
      lo = a;
      hi = b;
      break;
    }
  }
  const span = hi.p - lo.p || 1;
  const f = (t - lo.p) / span;
  const ch = (k: 0 | 1 | 2) => Math.round(lo.c[k] + (hi.c[k] - lo.c[k]) * f);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

/** CSS gradient string for the strength legend (weak → strong). */
export const STRENGTH_GRADIENT = `linear-gradient(to right, ${strengthColor(
  0,
)}, ${strengthColor(0.5)}, ${strengthColor(1)})`;

/** Visual radius used for hit areas, collision and edge endpoint trimming. */
export function nodeRadius(node: GraphNodeDto): number {
  switch (node.type) {
    case "finding":
      return 13;
    case "sandbox":
      return 20;
    default:
      return 19;
  }
}

/** Collision radius — larger than the shape so labels keep breathing room. */
export function collideRadius(node: GraphNodeDto): number {
  return node.type === "finding" ? 34 : 52;
}
