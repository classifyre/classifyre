import { FRAME_TITLE_HEIGHT, HYPOTHESIS_WIDTH } from "@workspace/case-board/lib/geometry";
import { ASSET_NODE, evidenceExtent, type Extent } from "./relations";
import { absolutePosition } from "./ops";
import type { BoardDomain, BoardItem } from "./types";

/**
 * Board geometry without a canvas: estimated sizes for items React Flow has
 * not measured yet (unplaced items are not rendered), and a free-spot search
 * used by auto-placement and the suggested-neighbour layout.
 */

export { FRAME_TITLE_HEIGHT, HYPOTHESIS_WIDTH };
export const DEFAULT_NOTE = { width: 220, height: 160 };
export const DEFAULT_FRAME = { width: 640, height: 400 };
/** Clear space kept between a frame's edge and what is inside it. */
export const FRAME_PADDING = 24;
/** A suggested neighbour is drawn like any asset. */
export const SUGGESTED_SIZE = { width: ASSET_NODE.width, height: ASSET_NODE.height };

export interface XY {
  x: number;
  y: number;
}

export interface Rect extends XY {
  w: number;
  h: number;
}

export function estimateItemSize(d: BoardDomain, item: BoardItem): { width: number; height: number } {
  switch (item.kind) {
    case "EVIDENCE":
      // The asset node itself; its findings sit around it (see itemExtent).
      return { width: ASSET_NODE.width, height: ASSET_NODE.height };
    case "HYPOTHESIS":
      return { width: HYPOTHESIS_WIDTH, height: 150 };
    case "COMMENT":
      return { width: 40, height: 32 };
    case "FRAME":
      return { width: item.width ?? DEFAULT_FRAME.width, height: item.height ?? DEFAULT_FRAME.height };
    case "NOTE":
      return { width: item.width ?? DEFAULT_NOTE.width, height: item.height ?? DEFAULT_NOTE.height };
  }
}

/** Evidence that was just added and knows nothing yet: the asset alone. */
export function newEvidenceSize(): { width: number; height: number } {
  return { width: ASSET_NODE.width, height: ASSET_NODE.height };
}

/**
 * The space an item takes relative to its position. For evidence that is the
 * asset and the findings around it, which reach left of and above the asset
 * node, hence the offsets.
 */
export function itemExtent(d: BoardDomain, item: BoardItem): Extent {
  if (item.kind === "EVIDENCE") return evidenceExtent(item, d.bubbles.get(item.id));
  const size = estimateItemSize(d, item);
  return { dx: 0, dy: 0, width: size.width, height: size.height };
}

/** Where placed items sit; frames are backgrounds, not obstacles. */
export function takenRects(d: BoardDomain, skip?: (item: BoardItem) => boolean): Rect[] {
  const taken: Rect[] = [];
  for (const item of d.items.values()) {
    if (item.x === null || item.y === null || item.kind === "FRAME" || skip?.(item)) continue;
    const abs = absolutePosition(d.items, item.id);
    const ext = itemExtent(d, item);
    taken.push({ x: abs.x + ext.dx, y: abs.y + ext.dy, w: ext.width, h: ext.height });
  }
  return taken;
}

export function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

/**
 * Walk outwards from `anchor` in rings until a spot that overlaps nothing.
 * `prefer` biases the first candidates of each ring (right of the anchor for
 * suggestions, so they read as "next to" what they belong to).
 */
export function freeSpotNear(
  anchor: XY,
  size: { width: number; height: number },
  taken: readonly Rect[],
  gap = 48,
  step = 60,
): XY {
  for (let ring = 0; ring < 60; ring += 1) {
    const d = ring * step;
    const candidates: XY[] =
      ring === 0
        ? [anchor]
        : [
            { x: anchor.x + d, y: anchor.y },
            { x: anchor.x, y: anchor.y + d },
            { x: anchor.x + d, y: anchor.y + d },
            { x: anchor.x + d, y: anchor.y - d },
            { x: anchor.x, y: anchor.y - d },
            { x: anchor.x - d, y: anchor.y },
            { x: anchor.x - d, y: anchor.y + d },
            { x: anchor.x - d, y: anchor.y - d },
          ];
    for (const c of candidates) {
      const r = { x: c.x, y: c.y, w: size.width, h: size.height };
      if (!taken.some((t) => overlaps(r, t, gap))) return c;
    }
  }
  return anchor;
}

/**
 * Where an item lands when it is moved into a frame: the first free spot,
 * row by row, inside the frame's padding. With no room left it goes below
 * everything there, and `grow` is the size the frame needs to hold it.
 * Positions are relative to the frame, as a child's are.
 */
export function spotInFrame(
  d: BoardDomain,
  frame: BoardItem,
  item: BoardItem,
): { at: XY; grow: { width: number; height: number } | null } {
  const width = frame.width ?? DEFAULT_FRAME.width;
  const height = frame.height ?? DEFAULT_FRAME.height;
  const ext = itemExtent(d, item);
  const top = FRAME_TITLE_HEIGHT + FRAME_PADDING / 2;
  const siblings: Rect[] = [];
  for (const child of d.items.values()) {
    if (child.parentId !== frame.id || child.id === item.id || child.x === null || child.y === null) continue;
    const e = itemExtent(d, child);
    siblings.push({ x: child.x + e.dx, y: child.y + e.dy, w: e.width, h: e.height });
  }
  const step = 20;
  for (let y = top; y + ext.height <= height - FRAME_PADDING; y += step) {
    for (let x = FRAME_PADDING; x + ext.width <= width - FRAME_PADDING; x += step) {
      const box = { x, y, w: ext.width, h: ext.height };
      if (!siblings.some((r) => overlaps(box, r, FRAME_PADDING))) {
        return { at: { x: x - ext.dx, y: y - ext.dy }, grow: null };
      }
    }
  }
  const x = FRAME_PADDING;
  const y = Math.max(top, ...siblings.map((r) => r.y + r.h + FRAME_PADDING));
  return {
    at: { x: x - ext.dx, y: y - ext.dy },
    grow: {
      width: Math.max(width, x + ext.width + FRAME_PADDING),
      height: Math.max(height, y + ext.height + FRAME_PADDING),
    },
  };
}
