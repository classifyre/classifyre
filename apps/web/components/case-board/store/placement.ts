import { freeSpotNear, type Rect, type XY } from "./geometry";

/** An item to place, with the box it needs relative to its position. */
export interface PlaceRequest {
  id: string;
  box: { dx: number; dy: number; width: number; height: number };
}

/**
 * Places new items next to what they connect to (PRD §8.9), growing outwards:
 * the item with the most neighbours already on the board goes first, and once
 * placed it anchors the items that only connect to it. So a batch that arrives
 * as a chain (evidence → hypothesis → evidence) lands as a chain, not as one
 * item by the board and the rest in the Incoming column.
 *
 * `rectOf` gives the rect of an item already on the board, `taken` the rects
 * nothing may overlap. Returns item positions (box offsets removed) and the
 * items with no path to the board, left for the caller to lay out as a block.
 */
export function placeNearNeighbours(opts: {
  items: readonly PlaceRequest[];
  rectOf: (id: string) => Rect | undefined;
  neighbours: (id: string) => readonly string[];
  taken: readonly Rect[];
  gap: number;
}): { positions: Map<string, XY>; orphans: PlaceRequest[] } {
  const { items, rectOf, neighbours, gap } = opts;
  const taken = [...opts.taken];
  const placed = new Map<string, Rect>();
  const positions = new Map<string, XY>();
  const rect = (id: string) => placed.get(id) ?? rectOf(id);
  const pending = new Map(items.map((i) => [i.id, i]));

  for (;;) {
    // Most anchors first; ties keep the input (model) order.
    let best: { item: PlaceRequest; anchors: Rect[] } | null = null;
    for (const item of pending.values()) {
      const anchors = neighbours(item.id)
        .filter((id) => id !== item.id)
        .map(rect)
        .filter((r): r is Rect => r !== undefined);
      if (anchors.length > 0 && (!best || anchors.length > best.anchors.length)) best = { item, anchors };
    }
    if (!best) break;
    const { item, anchors } = best;
    const cx = anchors.reduce((sum, r) => sum + r.x + r.w / 2, 0) / anchors.length;
    const cy = anchors.reduce((sum, r) => sum + r.y + r.h / 2, 0) / anchors.length;
    const size = { width: item.box.width, height: item.box.height };
    const at = freeSpotNear({ x: cx + 60, y: cy - size.height / 2 }, size, taken, gap);
    const r: Rect = { x: at.x, y: at.y, w: size.width, h: size.height };
    taken.push(r);
    placed.set(item.id, r);
    positions.set(item.id, { x: at.x - item.box.dx, y: at.y - item.box.dy });
    pending.delete(item.id);
  }
  return { positions, orphans: [...pending.values()] };
}
