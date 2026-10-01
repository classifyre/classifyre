import {
  DEFAULT_FRAME_SIZE,
  DEFAULT_NOTE_SIZE,
  FRAME_PADDING,
  FRAME_TITLE_HEIGHT,
  HYPOTHESIS_WIDTH,
  spotInFrame as spotInFrameBox,
  type Rect,
  type XY,
  TERM_CARD_SIZE,
} from "@workspace/schemas/case-board";
import { ASSET_NODE, evidenceExtent, type Extent } from "./relations";
import { absolutePosition } from "./ops";
import type { BoardDomain, BoardItem } from "./types";

/**
 * Board geometry without a canvas: estimated sizes for items React Flow has
 * not measured yet (unplaced items are not rendered), and a free-spot search
 * used by auto-placement and the suggested-neighbour layout.
 */

// The sizes and the free-spot search are shared with the API, which lays
// boards out for the MCP arrange tools (see @workspace/schemas/case-board).
export { FRAME_PADDING, FRAME_TITLE_HEIGHT, HYPOTHESIS_WIDTH };
export { freeSpotNear, overlaps, type Rect, type XY } from "@workspace/schemas/case-board";
export const DEFAULT_NOTE = DEFAULT_NOTE_SIZE;
export const DEFAULT_FRAME = DEFAULT_FRAME_SIZE;
/** A suggested neighbour is drawn like any asset. */
export const SUGGESTED_SIZE = { width: ASSET_NODE.width, height: ASSET_NODE.height };

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
    case "TERM":
      return { ...TERM_CARD_SIZE };
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
  const siblings: Rect[] = [];
  for (const child of d.items.values()) {
    if (child.parentId !== frame.id || child.id === item.id || child.x === null || child.y === null) continue;
    const e = itemExtent(d, child);
    siblings.push({ x: child.x + e.dx, y: child.y + e.dy, w: e.width, h: e.height });
  }
  return spotInFrameBox(
    { width: frame.width ?? DEFAULT_FRAME.width, height: frame.height ?? DEFAULT_FRAME.height },
    siblings,
    itemExtent(d, item),
  );
}
