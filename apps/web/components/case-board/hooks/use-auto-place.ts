"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import { useBoard, useBoardStore, useUiStore } from "../store/board-context";
import type { BoardState } from "../store/board-store";
import { placeItems, type XY } from "../store/commands";
import { ownerItem } from "../store/domain";
import { absolutePosition } from "../store/ops";
import { ASSET_NODE } from "../store/relations";
import { estimateItemSize, freeSpotNear, HYPOTHESIS_WIDTH, itemExtent, type Rect } from "../store/geometry";
import type { BoardItem } from "../store/types";
import { elkLayout, type LayoutEdge } from "./elk-layout";

const GAP = 48;

/** Size before React Flow has measured it (unplaced items are not rendered). */
export function estimateSize(s: BoardState, item: BoardItem): { width: number; height: number } {
  return estimateItemSize(s, item);
}

/**
 * The box an item needs, relative to its position: evidence brings its
 * findings along, so its box reaches past the asset node (negative dx/dy).
 * Measured sizes win for everything else.
 */
export function layoutBox(
  s: BoardState,
  item: BoardItem,
  measured?: { width?: number; height?: number },
): { dx: number; dy: number; width: number; height: number } {
  if (item.kind === "EVIDENCE" || !measured?.width || !measured.height) return itemExtent(s, item);
  return { dx: 0, dy: 0, width: measured.width, height: measured.height };
}

/** Items an item is connected to: through system edges, stances and links. */
export function neighboursOf(s: BoardState, item: BoardItem): string[] {
  const out = new Set<string>();
  if (item.kind === "EVIDENCE") {
    const bubble = s.bubbles.get(item.id);
    const keys = new Set<string>();
    if (bubble) {
      keys.add(`asset:${bubble.assetId}`);
      for (const r of bubble.rows) keys.add(`finding:${r.findingId}`);
    }
    for (const e of s.systemEdges.values()) {
      if (keys.has(e.from)) {
        const other = ownerItem(s, e.to);
        if (other && other !== item.id) out.add(other);
      }
      if (keys.has(e.to)) {
        const other = ownerItem(s, e.from);
        if (other && other !== item.id) out.add(other);
      }
    }
    for (const support of s.supports.values()) {
      if (support.endpoint?.itemId !== item.id) continue;
      const hyp = s.threads.get(support.threadId)?.itemId;
      if (hyp) out.add(hyp);
    }
  }
  if (item.kind === "HYPOTHESIS" && item.refId) {
    for (const support of s.supports.values()) {
      if (support.threadId === item.refId && support.endpoint) out.add(support.endpoint.itemId);
    }
  }
  for (const link of s.links.values()) {
    if (link.sourceItemId === item.id) out.add(link.targetItemId);
    if (link.targetItemId === item.id) out.add(link.sourceItemId);
  }
  out.delete(item.id);
  return [...out];
}

/**
 * Places items the server created unplaced (PRD §8.9): the first open of an
 * existing case gets one full ELK layout; after that, new items go next to
 * what they connect to, or into an "Incoming" column right of the board.
 * Placement is a system action, so it is not on the undo stack.
 */
export function useAutoPlace(): void {
  const store = useBoardStore();
  const ui = useUiStore();
  const rf = useReactFlow();
  const loaded = useBoard((s) => s.loaded);
  const readOnly = useBoard((s) => s.readOnly);
  const unplacedKey = useBoard((s) => {
    const ids: string[] = [];
    for (const item of s.items.values()) {
      if ((item.x === null || item.y === null) && !item.pending) ids.push(item.id);
    }
    return ids.join(",");
  });
  const running = React.useRef(false);

  React.useEffect(() => {
    if (!loaded || readOnly || !unplacedKey || running.current) return;
    running.current = true;
    void (async () => {
      const s = store.getState();
      const all = [...s.items.values()];
      const unplaced = all.filter((i) => i.x === null || i.y === null);
      const placed = all.filter((i) => i.x !== null && i.y !== null);
      const positions = new Map<string, XY>();
      const incoming: string[] = [];

      const rectOf = (item: BoardItem): Rect => {
        const internal = rf.getInternalNode(item.id);
        const abs = internal?.internals.positionAbsolute ?? absolutePosition(s.items, item.id);
        const box = layoutBox(s, item, internal?.measured);
        return { x: abs.x + box.dx, y: abs.y + box.dy, w: box.width, h: box.height };
      };

      // Comments hang off the item they annotate, top-right corner.
      const floating: BoardItem[] = [];
      const hints = new Map(ui.getState().placementHints);
      let hintsUsed = false;
      for (const item of unplaced) {
        const bubble = item.kind === "EVIDENCE" ? s.bubbles.get(item.id) : undefined;
        const hintKey = bubble
          ? [`asset:${bubble.assetId}`, ...bubble.rows.map((r) => `finding:${r.findingId}`)].find((k) =>
              hints.has(k),
            )
          : undefined;
        if (hintKey) {
          positions.set(item.id, hints.get(hintKey)!);
          hints.delete(hintKey);
          hintsUsed = true;
          continue;
        }
        if (item.kind === "COMMENT" && item.parentId) {
          const parent = s.items.get(item.parentId);
          const parentBubble = parent?.kind === "EVIDENCE" ? s.bubbles.get(parent.id) : undefined;
          if (parent && parentBubble) {
            // Just outside the asset's ring, at half past one.
            const reach = ASSET_NODE.ring + 6;
            positions.set(item.id, {
              x: Math.round(ASSET_NODE.cx + reach * Math.SQRT1_2 - 8),
              y: Math.round(ASSET_NODE.cy - reach * Math.SQRT1_2 - 24),
            });
          } else {
            const width = parent ? estimateSize(s, parent).width : HYPOTHESIS_WIDTH;
            positions.set(item.id, { x: width - 12, y: -14 });
          }
        } else {
          floating.push(item);
        }
      }

      if (placed.filter((i) => !i.parentId).length === 0) {
        // First open of a case that predates the board: one layout for all.
        const boxes = new Map(floating.map((i) => [i.id, layoutBox(s, i)]));
        const nodes = floating.map((i) => ({ id: i.id, width: boxes.get(i.id)!.width, height: boxes.get(i.id)!.height }));
        // (Items with a placement hint were placed above and are not in `floating`.)
        const edges: LayoutEdge[] = [];
        for (const item of floating) {
          for (const other of neighboursOf(s, item)) {
            edges.push({ id: `${item.id}->${other}`, source: item.id, target: other });
          }
        }
        const laid = await elkLayout(nodes, edges);
        // ELK places boxes; an item's position is its box minus the reach of its findings.
        for (const [id, pos] of laid) {
          const box = boxes.get(id)!;
          positions.set(id, { x: pos.x - box.dx, y: pos.y - box.dy });
        }
      } else {
        const taken = placed.filter((i) => !i.parentId).map(rectOf);
        const right = Math.max(...taken.map((r) => r.x + r.w));
        const top = Math.min(...taken.map((r) => r.y));
        let incomingY = top;
        for (const item of floating) {
          const box = layoutBox(s, item);
          const size = { width: box.width, height: box.height };
          const anchors = neighboursOf(s, item)
            .map((id) => s.items.get(id))
            .filter((i): i is BoardItem => !!i && i.x !== null && i.y !== null)
            .map(rectOf);
          let pos: XY;
          if (anchors.length > 0) {
            const cx = anchors.reduce((sum, r) => sum + r.x + r.w / 2, 0) / anchors.length;
            const cy = anchors.reduce((sum, r) => sum + r.y + r.h / 2, 0) / anchors.length;
            pos = freeSpotNear({ x: cx + 60, y: cy - size.height / 2 }, size, taken, GAP);
          } else {
            pos = { x: right + 240, y: incomingY };
            incomingY += size.height + GAP;
            incoming.push(item.id);
          }
          taken.push({ x: pos.x, y: pos.y, w: size.width, h: size.height });
          positions.set(item.id, { x: pos.x - box.dx, y: pos.y - box.dy });
        }
      }

      if (hintsUsed) ui.getState().set({ placementHints: hints });
      if (positions.size > 0) store.getState().run(placeItems(positions));
      if (incoming.length > 0) {
        const next = new Set(ui.getState().incoming);
        for (const id of incoming) next.add(id);
        ui.getState().set({ incoming: next });
      }
    })().finally(() => {
      running.current = false;
    });
  }, [loaded, readOnly, unplacedKey, store, ui, rf]);
}
