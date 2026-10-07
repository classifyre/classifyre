import {
  ASSET_NODE,
  COMMENT_PIN_SIZE,
  TERM_CARD_SIZE,
  DEFAULT_FRAME_SIZE,
  DEFAULT_NOTE_SIZE,
  FINDING_NODE,
  FRAME_PADDING,
  FRAME_TITLE_HEIGHT,
  HYPOTHESIS_WIDTH,
  MAX_FINDING_NODES,
  MIN_FRAME_SIZE,
  estimateHypothesisHeight,
  evidenceExtent,
  freeSpotNear,
  layeredLayout,
  placeNearNeighbours,
  spotInFrame,
  type Extent,
  type LayoutEdge,
  type Rect,
  type XY,
} from '@workspace/schemas/case-board';
import type { BoardItemDto, CaseBoardResponseDto } from '../dto/case-board.dto';

/**
 * Laying a case board out without a browser: the arithmetic behind the MCP
 * arrange tools (place new items, tidy up, group into a frame). The web board
 * does the same with measured sizes and ELK; here sizes are estimated from
 * the same shared geometry (`@workspace/schemas/case-board`), so what the
 * API places and what the browser places agree on what overlaps what.
 *
 * Pure over a board read (`CaseBoardResponseDto`): the service turns the
 * plans into ordinary `item.update` / `item.create` ops.
 */

/** Gap kept between items placed next to each other (the web's auto-place). */
const PLACE_GAP = 48;
/** New items with nothing to sit next to go this far right of the board. */
const INCOMING_OFFSET = 240;

export interface BoardModel {
  items: Map<string, BoardItemDto>;
  /** EVIDENCE item → its asset and the findings the case holds on it, in order. */
  evidence: Map<string, { assetId: string; findingIds: string[] }>;
  /** Thread id → title (hypothesis cards grow with their statement). */
  threadTitle: Map<string, string>;
  /**
   * Relations between items, as the board draws them: platform relations
   * between evidence (lineage, duplicates, references), drawn links, and
   * hypothesis stances (hypothesis → evidence). Directed as drawn.
   */
  relations: BoardRelation[];
}

export interface BoardRelation {
  source: string;
  target: string;
  /**
   * platform: an edge the scans or the duplicates engine produced, which no
   * op can change; link: drawn on this board; stance: a hypothesis's stance.
   */
  via: 'platform' | 'link' | 'stance';
  /** A platform relation's type: likely_duplicate, related, a lineage type… */
  relationType?: string;
}

export function buildBoardModel(res: CaseBoardResponseDto): BoardModel {
  const items = new Map(res.items.map((i) => [i.id, i]));
  const evidenceById = new Map(res.evidence.map((e) => [e.id, e]));
  const evidence = new Map<string, { assetId: string; findingIds: string[] }>();
  const itemByAsset = new Map<string, string>();
  const itemByFinding = new Map<string, string>();
  for (const item of items.values()) {
    if (item.kind !== 'EVIDENCE' || !item.refId) continue;
    const ev = evidenceById.get(item.refId);
    if (!ev) continue;
    const findingIds = (ev.findings ?? []).map((f) => f.findingId);
    evidence.set(item.id, { assetId: ev.entityId, findingIds });
    itemByAsset.set(ev.entityId, item.id);
    for (const id of findingIds) itemByFinding.set(id, item.id);
  }
  // A finding of an asset on the board belongs to that asset's bubble even
  // when the case does not hold it (the board draws it on demand).
  for (const n of res.graph?.nodes ?? []) {
    if (n.type !== 'finding' || !n.assetId || itemByFinding.has(n.id)) continue;
    const owner = itemByAsset.get(n.assetId);
    if (owner) itemByFinding.set(n.id, owner);
  }
  const ownerOf = (type: string, id: string): string | undefined =>
    type === 'asset'
      ? itemByAsset.get(id)
      : type === 'finding'
        ? itemByFinding.get(id)
        : undefined;

  const relations: BoardRelation[] = [];
  const seen = new Set<string>();
  const relate = (
    source: string | undefined,
    target: string | undefined,
    via: BoardRelation['via'],
    relationType?: string,
  ) => {
    if (!source || !target || source === target) return;
    if (!items.has(source) || !items.has(target)) return;
    const key = `${via}|${source}|${target}|${relationType ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    relations.push({
      source,
      target,
      via,
      ...(relationType ? { relationType } : {}),
    });
  };
  for (const e of res.graph?.edges ?? []) {
    // The board never draws containment: a finding sits by its asset.
    if (e.relationType === 'CONTAINS' || e.relationClass === 'CONTAINMENT')
      continue;
    relate(
      ownerOf(e.fromType, e.fromId),
      ownerOf(e.toType, e.toId),
      'platform',
      e.relationType,
    );
  }
  for (const link of res.links) {
    relate(link.sourceItemId, link.targetItemId, 'link');
  }
  const threadItem = new Map<string, string>();
  const threadTitle = new Map<string, string>();
  for (const t of res.threads) {
    threadTitle.set(t.id, t.title);
    if (t.itemId && t.onBoard) threadItem.set(t.id, t.itemId);
  }
  for (const s of res.supports) {
    if (s.endpoint) {
      relate(threadItem.get(s.threadId), s.endpoint.itemId, 'stance');
    }
  }
  return { items, evidence, threadTitle, relations };
}

const isPlaced = (item: BoardItemDto) => item.x !== null && item.y !== null;

function styleOf(item: BoardItemDto): Record<string, unknown> {
  return item.style ?? {};
}

function findingPositionsOf(
  item: BoardItemDto,
): Record<string, XY | null | undefined> | null {
  const raw = styleOf(item).findingPositions;
  return raw && typeof raw === 'object'
    ? (raw as Record<string, XY | null | undefined>)
    : null;
}

/** The finding ids someone dragged away from their default spot. */
export function movedFindings(item: BoardItemDto): string[] {
  const positions = findingPositionsOf(item);
  return positions
    ? Object.keys(positions).filter((k) => positions[k] != null)
    : [];
}

/**
 * The room an item takes around its position. `resetFindings` sizes evidence
 * with every finding back at its default spot, which is how Tidy up leaves it.
 */
export function boxOf(
  model: BoardModel,
  item: BoardItemDto,
  opts: { resetFindings?: boolean } = {},
): Extent {
  switch (item.kind) {
    case 'EVIDENCE': {
      const findingIds = model.evidence.get(item.id)?.findingIds ?? [];
      const positions = opts.resetFindings ? null : findingPositionsOf(item);
      const shown = findingIds.slice(0, MAX_FINDING_NODES);
      const box = evidenceExtent({
        collapsed: item.collapsed,
        findingIds: shown,
        findingPositions: positions,
      });
      if (item.collapsed || !positions) return box;
      // The browser orders findings by state and severity before it folds
      // the rest away, so a dragged finding past our first twelve may still
      // be drawn: count its spot too rather than risk an overlap.
      let x0 = box.dx;
      let y0 = box.dy;
      let x1 = box.dx + box.width;
      let y1 = box.dy + box.height;
      for (const id of findingIds.slice(MAX_FINDING_NODES)) {
        const spot = positions[id];
        if (!spot) continue;
        x0 = Math.min(x0, spot.x);
        y0 = Math.min(y0, spot.y);
        x1 = Math.max(x1, spot.x + FINDING_NODE.width);
        y1 = Math.max(y1, spot.y + FINDING_NODE.height);
      }
      return { dx: x0, dy: y0, width: x1 - x0, height: y1 - y0 };
    }
    case 'HYPOTHESIS':
      return {
        dx: 0,
        dy: 0,
        width: HYPOTHESIS_WIDTH,
        height: estimateHypothesisHeight(
          item.refId ? model.threadTitle.get(item.refId) : null,
        ),
      };
    case 'NOTE':
      return {
        dx: 0,
        dy: 0,
        width: item.width ?? DEFAULT_NOTE_SIZE.width,
        height: item.height ?? DEFAULT_NOTE_SIZE.height,
      };
    case 'TERM':
      return {
        dx: 0,
        dy: 0,
        width: TERM_CARD_SIZE.width,
        height: TERM_CARD_SIZE.height,
      };
    case 'FRAME':
      return {
        dx: 0,
        dy: 0,
        width: item.width ?? DEFAULT_FRAME_SIZE.width,
        height: item.collapsed
          ? FRAME_TITLE_HEIGHT
          : (item.height ?? DEFAULT_FRAME_SIZE.height),
      };
    default:
      return {
        dx: 0,
        dy: 0,
        width: COMMENT_PIN_SIZE.width,
        height: COMMENT_PIN_SIZE.height,
      };
  }
}

/** An item's top-left on the canvas: frame children and pins are parent-relative. */
export function absolutePosition(model: BoardModel, itemId: string): XY {
  let x = 0;
  let y = 0;
  const seen = new Set<string>();
  let cursor: string | null = itemId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const item = model.items.get(cursor);
    if (!item) break;
    x += item.x ?? 0;
    y += item.y ?? 0;
    cursor = item.parentId;
  }
  return { x, y };
}

export function rectOf(
  model: BoardModel,
  item: BoardItemDto,
  opts: { resetFindings?: boolean } = {},
): Rect {
  const at = absolutePosition(model, item.id);
  const box = boxOf(model, item, opts);
  return { x: at.x + box.dx, y: at.y + box.dy, w: box.width, h: box.height };
}

function neighboursOf(model: BoardModel, itemId: string): string[] {
  const out = new Set<string>();
  for (const r of model.relations) {
    if (r.source === itemId) out.add(r.target);
    if (r.target === itemId) out.add(r.source);
  }
  out.delete(itemId);
  return [...out];
}

function relationsAmong(
  model: BoardModel,
  ids: ReadonlySet<string>,
  ownerOf: (id: string) => string | undefined = (id) => id,
): LayoutEdge[] {
  const edges: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (const r of model.relations) {
    const source = ownerOf(r.source);
    const target = ownerOf(r.target);
    if (!source || !target || source === target) continue;
    if (!ids.has(source) || !ids.has(target)) continue;
    const key = `${source}|${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source, target });
  }
  return edges;
}

/** Where a comment pin hangs off the item it annotates (the web's auto-place). */
function pinSpot(model: BoardModel, parent: BoardItemDto): XY {
  if (parent.kind === 'EVIDENCE') {
    // Just outside the asset's ring, at half past one.
    const reach = ASSET_NODE.ring + 6;
    return {
      x: Math.round(ASSET_NODE.cx + reach * Math.SQRT1_2 - 8),
      y: Math.round(ASSET_NODE.cy - reach * Math.SQRT1_2 - 24),
    };
  }
  return { x: boxOf(model, parent).width - 12, y: -14 };
}

/**
 * Positions for every item that has none yet — evidence, hypotheses or
 * comments added without x/y — as the board would place them when someone
 * opens it: comment pins by their item, the rest next to what they connect
 * to, anything with nothing to sit next to as one block right of the board.
 * A board with nothing placed yet gets one layered layout. Positions of
 * children (pins) are parent-relative.
 */
export function planPlacement(
  model: BoardModel,
  only?: ReadonlySet<string>,
): Map<string, XY> {
  const all = [...model.items.values()];
  const positions = new Map<string, XY>();
  const floating: BoardItemDto[] = [];
  for (const item of all) {
    if (isPlaced(item)) continue;
    // With `only`, everything else stays unplaced for whoever opens the board.
    if (only && !only.has(item.id)) continue;
    const parent = item.parentId ? model.items.get(item.parentId) : undefined;
    if (item.kind === 'COMMENT' && parent) {
      positions.set(item.id, pinSpot(model, parent));
    } else {
      floating.push(item);
    }
  }
  if (floating.length === 0) return positions;

  const boxes = new Map(floating.map((i) => [i.id, boxOf(model, i)]));
  const placedTop = all.filter((i) => isPlaced(i) && !i.parentId);
  if (placedTop.length === 0) {
    const ids = new Set(floating.map((i) => i.id));
    const laid = layeredLayout(
      floating.map((i) => ({
        id: i.id,
        width: boxes.get(i.id)!.width,
        height: boxes.get(i.id)!.height,
      })),
      relationsAmong(model, ids),
    );
    for (const [id, p] of laid) {
      const box = boxes.get(id)!;
      positions.set(id, { x: p.x - box.dx, y: p.y - box.dy });
    }
    return positions;
  }

  const taken = placedTop.map((i) => rectOf(model, i));
  const onBoard = (id: string): Rect | undefined => {
    const other = model.items.get(id);
    return other && isPlaced(other) ? rectOf(model, other) : undefined;
  };
  const { positions: near, orphans } = placeNearNeighbours({
    items: floating.map((i) => ({ id: i.id, box: boxes.get(i.id)! })),
    rectOf: onBoard,
    neighbours: (id) => neighboursOf(model, id),
    taken,
    gap: PLACE_GAP,
  });
  for (const [id, pos] of near) {
    positions.set(id, { x: Math.round(pos.x), y: Math.round(pos.y) });
    const box = boxes.get(id)!;
    taken.push({
      x: pos.x + box.dx,
      y: pos.y + box.dy,
      w: box.width,
      h: box.height,
    });
  }
  if (orphans.length > 0) {
    // Nothing on the board to sit next to: one compact block right of
    // everything, top-aligned, rather than a column that grows with each item.
    const right = Math.max(...taken.map((r) => r.x + r.w));
    const top = Math.min(...taken.map((r) => r.y));
    const laid = layeredLayout(
      orphans.map((o) => ({
        id: o.id,
        width: o.box.width,
        height: o.box.height,
      })),
      relationsAmong(model, new Set(orphans.map((o) => o.id))),
      { x: right + INCOMING_OFFSET, y: top },
    );
    for (const o of orphans) {
      const p = laid.get(o.id);
      if (p) positions.set(o.id, { x: p.x - o.box.dx, y: p.y - o.box.dy });
    }
  }
  return positions;
}

/** What {@link planArrivals} decided for evidence that just landed. */
export interface ArrivalPlan {
  /** Evidence going inside a frame, one plan per frame (positions are frame-relative). */
  frames: Array<{ frameId: string; plan: FramePlan }>;
  /** Evidence going next to its hypothesis on the open canvas (absolute positions). */
  positions: Map<string, XY>;
}

/**
 * Where evidence that a hypothesis rule just linked lands: inside the frame
 * its hypothesis sits in, or right beside the hypothesis when that is on the
 * open canvas. It is the board's own placement, only started from the
 * hypothesis rather than from wherever the browser would put an unplaced item.
 *
 * Only unplaced evidence with a placed hypothesis is touched. Anything else
 * (no hypothesis yet on the canvas, an asset that already has a spot) is left
 * for the board's own auto-place, exactly as before this existed. A frame that
 * is folded stays folded: the item goes inside it, the frame is not opened.
 */
export function planArrivals(
  model: BoardModel,
  itemIds: ReadonlySet<string>,
): ArrivalPlan {
  const byFrame = new Map<string, string[]>();
  const open: string[] = [];
  for (const id of itemIds) {
    const item = model.items.get(id);
    if (!item || item.kind !== 'EVIDENCE' || isPlaced(item) || item.parentId) {
      continue;
    }
    const anchors = neighboursOf(model, id)
      .map((n) => model.items.get(n))
      .filter(
        (n): n is BoardItemDto => !!n && n.kind === 'HYPOTHESIS' && isPlaced(n),
      );
    if (anchors.length === 0) continue;
    // A hypothesis in a frame draws the evidence into it; the first one wins
    // when the evidence belongs to hypotheses in different frames.
    const framed = anchors.find((a) => a.parentId);
    if (framed?.parentId) {
      const list = byFrame.get(framed.parentId) ?? [];
      list.push(id);
      byFrame.set(framed.parentId, list);
    } else {
      open.push(id);
    }
  }

  const frames: ArrivalPlan['frames'] = [];
  for (const [frameId, ids] of byFrame) {
    try {
      frames.push({
        frameId,
        plan: planFrame(model, ids, { kind: 'existing', frameId }),
      });
    } catch (error) {
      // A frame that vanished or is not a frame: fall back to the open canvas.
      if (!(error instanceof FramePlanError)) throw error;
      open.push(...ids);
    }
  }
  return {
    frames,
    positions:
      open.length > 0 ? planPlacement(model, new Set(open)) : new Map(),
  };
}

export interface PlannedMove {
  itemId: string;
  from: XY | null;
  to: XY;
}

export interface TidyPlan {
  moves: PlannedMove[];
  /** Evidence whose dragged findings go back to their default spots. */
  resetFindings: Array<{ itemId: string; findingIds: string[] }>;
}

/**
 * Tidy up (PRD §8.9): one layered layout, left to right, of everything at the
 * top level of the board — items inside a frame travel with their frame —
 * anchored where the board starts now. Dragged findings go back to their
 * default spots, and items with no position yet are laid out with the rest.
 * Relations of items inside a frame pull on the frame.
 */
export function planTidy(model: BoardModel): TidyPlan {
  const top = [...model.items.values()].filter(
    (i) => !i.parentId && i.kind !== 'COMMENT',
  );
  const moves: PlannedMove[] = [];
  const resetFindings: TidyPlan['resetFindings'] = [];
  if (top.length > 0) {
    const boxes = new Map(
      top.map((i) => [i.id, boxOf(model, i, { resetFindings: true })]),
    );
    const ids = new Set(top.map((i) => i.id));
    const topLevelOf = (id: string): string | undefined => {
      const seen = new Set<string>();
      let cursor: string | undefined = id;
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const item = model.items.get(cursor);
        if (!item) return undefined;
        if (!item.parentId) return item.id;
        cursor = item.parentId;
      }
      return undefined;
    };
    const placedTop = top.filter(isPlaced);
    const origin =
      placedTop.length > 0
        ? {
            x: Math.min(...placedTop.map((i) => i.x! + boxes.get(i.id)!.dx)),
            y: Math.min(...placedTop.map((i) => i.y! + boxes.get(i.id)!.dy)),
          }
        : { x: 0, y: 0 };
    const laid = layeredLayout(
      top.map((i) => ({
        id: i.id,
        width: boxes.get(i.id)!.width,
        height: boxes.get(i.id)!.height,
      })),
      relationsAmong(model, ids, topLevelOf),
      origin,
    );
    for (const item of top) {
      const p = laid.get(item.id);
      if (!p) continue;
      const box = boxes.get(item.id)!;
      const to = { x: Math.round(p.x - box.dx), y: Math.round(p.y - box.dy) };
      const from = isPlaced(item) ? { x: item.x!, y: item.y! } : null;
      if (from && from.x === to.x && from.y === to.y) continue;
      moves.push({ itemId: item.id, from, to });
    }
    for (const item of top) {
      if (item.kind !== 'EVIDENCE') continue;
      const findingIds = movedFindings(item);
      if (findingIds.length > 0)
        resetFindings.push({ itemId: item.id, findingIds });
    }
  }
  // Pins without a spot hang off their item, as a board read would place them.
  for (const item of model.items.values()) {
    if (item.kind !== 'COMMENT' || isPlaced(item) || !item.parentId) continue;
    const parent = model.items.get(item.parentId);
    if (parent)
      moves.push({ itemId: item.id, from: null, to: pinSpot(model, parent) });
  }
  return { moves, resetFindings };
}

export type FrameTarget =
  | { kind: 'existing'; frameId: string }
  | {
      kind: 'new';
      frameId: string;
      title: string;
      /** compact: lay the members out anew inside; keep: frame them where they are. */
      arrangement: 'compact' | 'keep';
    };

export interface FramePlan {
  /** Where a new frame goes, and its size. */
  frame: { id: string; x: number; y: number; width: number; height: number };
  /** An existing frame that must grow (or open) to hold its new members. */
  resize: { width: number; height: number; expand: boolean } | null;
  /** Members and their new spot, relative to the frame. */
  members: Array<{
    itemId: string;
    from: { x: number | null; y: number | null; parentId: string | null };
    to: XY;
  }>;
  skipped: Array<{ itemId: string; reason: string }>;
}

export class FramePlanError extends Error {}

/**
 * Put items in a frame (the board's "Move to frame", for a whole selection).
 * Into an existing frame, each item takes the first free spot inside it and
 * the frame grows when full. A new frame either lays its members out anew
 * (`compact`, relations left to right) next to where they were, clear of the
 * rest of the board, or wraps them where they stand (`keep`).
 */
export function planFrame(
  model: BoardModel,
  itemIds: readonly string[],
  target: FrameTarget,
): FramePlan {
  const skipped: FramePlan['skipped'] = [];
  const existing =
    target.kind === 'existing' ? model.items.get(target.frameId) : undefined;
  if (target.kind === 'existing') {
    if (!existing)
      throw new FramePlanError(
        `Frame ${target.frameId} is not on this board. Call get_case_board to list frames.`,
      );
    if (existing.kind !== 'FRAME')
      throw new FramePlanError(
        `Item ${target.frameId} is a ${existing.kind}, not a FRAME.`,
      );
  }
  const frameId = target.frameId;
  // A frame cannot go inside itself or inside a frame nested in it.
  const ancestors = new Set<string>();
  for (
    let cursor: string | null = existing?.parentId ?? null;
    cursor && !ancestors.has(cursor);
    cursor = model.items.get(cursor)?.parentId ?? null
  ) {
    ancestors.add(cursor);
  }

  const members: BoardItemDto[] = [];
  const picked = new Set<string>();
  for (const id of itemIds) {
    if (picked.has(id)) continue;
    picked.add(id);
    const item = model.items.get(id);
    if (!item) {
      skipped.push({ itemId: id, reason: 'Not on this board' });
    } else if (item.kind === 'COMMENT') {
      skipped.push({
        itemId: id,
        reason:
          'A comment pin hangs off the item it annotates; frame that item instead',
      });
    } else if (id === frameId) {
      skipped.push({ itemId: id, reason: 'A frame cannot contain itself' });
    } else if (ancestors.has(id)) {
      skipped.push({
        itemId: id,
        reason: 'That frame already contains this one',
      });
    } else if (item.parentId === frameId) {
      skipped.push({ itemId: id, reason: 'Already in the frame' });
    } else {
      members.push(item);
    }
  }
  const fromOf = (item: BoardItemDto) => ({
    x: item.x,
    y: item.y,
    parentId: item.parentId,
  });

  if (existing) {
    let size = {
      width: existing.width ?? DEFAULT_FRAME_SIZE.width,
      height: existing.height ?? DEFAULT_FRAME_SIZE.height,
    };
    const start = { ...size };
    const siblings: Rect[] = [];
    for (const child of model.items.values()) {
      if (child.parentId !== existing.id || !isPlaced(child)) continue;
      const box = boxOf(model, child);
      siblings.push({
        x: child.x! + box.dx,
        y: child.y! + box.dy,
        w: box.width,
        h: box.height,
      });
    }
    const planned: FramePlan['members'] = [];
    for (const item of members) {
      const box = boxOf(model, item);
      const { at, grow } = spotInFrame(size, siblings, box);
      if (grow) size = grow;
      siblings.push({
        x: at.x + box.dx,
        y: at.y + box.dy,
        w: box.width,
        h: box.height,
      });
      planned.push({
        itemId: item.id,
        from: fromOf(item),
        to: { x: Math.round(at.x), y: Math.round(at.y) },
      });
    }
    const grew = size.width !== start.width || size.height !== start.height;
    return {
      frame: {
        id: existing.id,
        x: existing.x ?? 0,
        y: existing.y ?? 0,
        width: size.width,
        height: size.height,
      },
      resize:
        grew || existing.collapsed
          ? {
              width: Math.ceil(size.width),
              height: Math.ceil(size.height),
              expand: existing.collapsed,
            }
          : null,
      members: planned,
      skipped,
    };
  }

  if (members.length === 0) {
    throw new FramePlanError(
      `None of the items can go in a frame: ${skipped
        .map((s) => `${s.itemId} (${s.reason})`)
        .join('; ')}`,
    );
  }
  const inset = { x: FRAME_PADDING, y: FRAME_TITLE_HEIGHT + FRAME_PADDING / 2 };
  const memberIds = new Set(members.map((m) => m.id));
  const keep =
    target.kind === 'new' &&
    target.arrangement === 'keep' &&
    members.every(isPlaced);

  if (keep) {
    // Wrap the members where they stand.
    const rects = members.map((m) => rectOf(model, m));
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    const frame = {
      id: frameId,
      x: Math.round(minX - inset.x),
      y: Math.round(minY - inset.y),
      width: Math.max(
        MIN_FRAME_SIZE.width,
        Math.ceil(maxX - minX + 2 * FRAME_PADDING),
      ),
      height: Math.max(
        MIN_FRAME_SIZE.height,
        Math.ceil(maxY - minY + inset.y + FRAME_PADDING),
      ),
    };
    return {
      frame,
      resize: null,
      members: members.map((m) => {
        const at = absolutePosition(model, m.id);
        return {
          itemId: m.id,
          from: fromOf(m),
          to: { x: Math.round(at.x - frame.x), y: Math.round(at.y - frame.y) },
        };
      }),
      skipped,
    };
  }

  // Lay the members out anew inside the frame, relations left to right.
  const boxes = new Map(members.map((m) => [m.id, boxOf(model, m)]));
  const laid = layeredLayout(
    members.map((m) => ({
      id: m.id,
      width: boxes.get(m.id)!.width,
      height: boxes.get(m.id)!.height,
    })),
    relationsAmong(model, memberIds),
    inset,
  );
  let right = 0;
  let bottom = 0;
  for (const m of members) {
    const p = laid.get(m.id)!;
    const box = boxes.get(m.id)!;
    right = Math.max(right, p.x + box.width);
    bottom = Math.max(bottom, p.y + box.height);
  }
  const size = {
    width: Math.max(MIN_FRAME_SIZE.width, Math.ceil(right + FRAME_PADDING)),
    height: Math.max(MIN_FRAME_SIZE.height, Math.ceil(bottom + FRAME_PADDING)),
  };
  // Where the members were (or right of the board, if none was placed),
  // moved just far enough to clear everything else at the top level.
  const others = [...model.items.values()].filter(
    (i) => !i.parentId && isPlaced(i) && !memberIds.has(i.id),
  );
  const taken = others.map((i) => rectOf(model, i));
  const placedMembers = members.filter(isPlaced);
  let anchor: XY;
  if (placedMembers.length > 0) {
    const rects = placedMembers.map((m) => rectOf(model, m));
    anchor = {
      x: Math.min(...rects.map((r) => r.x)),
      y: Math.min(...rects.map((r) => r.y)),
    };
  } else if (taken.length > 0) {
    anchor = {
      x: Math.max(...taken.map((r) => r.x + r.w)) + INCOMING_OFFSET,
      y: Math.min(...taken.map((r) => r.y)),
    };
  } else {
    anchor = { x: 0, y: 0 };
  }
  const at = freeSpotNear(anchor, size, taken, PLACE_GAP);
  return {
    frame: {
      id: frameId,
      x: Math.round(at.x),
      y: Math.round(at.y),
      width: size.width,
      height: size.height,
    },
    resize: null,
    members: members.map((m) => {
      const p = laid.get(m.id)!;
      const box = boxes.get(m.id)!;
      return {
        itemId: m.id,
        from: fromOf(m),
        to: { x: Math.round(p.x - box.dx), y: Math.round(p.y - box.dy) },
      };
    }),
    skipped,
  };
}

/** The placed top-level extent of the board, for summaries: null when empty. */
export function boardBounds(
  model: BoardModel,
): { x: number; y: number; width: number; height: number } | null {
  const rects = [...model.items.values()]
    .filter((i) => !i.parentId && isPlaced(i))
    .map((i) => rectOf(model, i));
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.max(...rects.map((r) => r.x + r.w)) - x),
    height: Math.round(Math.max(...rects.map((r) => r.y + r.h)) - y),
  };
}
