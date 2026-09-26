import { Position, type InternalNode } from "@xyflow/react";
import { circleAnchor, type RoundShape, type XY } from "./geometry";

/**
 * Anchored floating edges (PRD §8.6). Assets and findings are circles: an edge
 * ends where the line between the two centres crosses the circle. Cards
 * (hypotheses, notes, frames) take the nearest point of their border facing
 * the other end. Everything is computed from React Flow's measured internals,
 * so edges follow nodes while they are dragged.
 */

export type { XY };

export interface Anchor extends XY {
  pos: Position;
  /** The outward direction at the anchor. */
  normal: XY;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectOf(n: InternalNode): Rect {
  return {
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    w: n.measured.width ?? n.width ?? 0,
    h: n.measured.height ?? n.height ?? 0,
  };
}

function roundOf(n: InternalNode): RoundShape | null {
  return (n.data as { round?: RoundShape } | undefined)?.round ?? null;
}

export function centreOf(n: InternalNode): XY {
  const round = roundOf(n);
  if (round) {
    return { x: n.internals.positionAbsolute.x + round.cx, y: n.internals.positionAbsolute.y + round.cy };
  }
  const r = rectOf(n);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function normalOf(pos: Position): XY {
  switch (pos) {
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Right:
      return { x: 1, y: 0 };
    case Position.Top:
      return { x: 0, y: -1 };
    case Position.Bottom:
      return { x: 0, y: 1 };
  }
}

function positionOf(nx: number, ny: number): Position {
  if (Math.abs(nx) > Math.abs(ny)) return nx > 0 ? Position.Right : Position.Left;
  return ny > 0 ? Position.Bottom : Position.Top;
}

/** Where the line from the node's centre towards `towards` crosses its border. */
export function borderAnchor(n: InternalNode, towards: XY): Anchor {
  const r = rectOf(n);
  const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  const dx = towards.x - c.x;
  const dy = towards.y - c.y;
  if (dx === 0 && dy === 0) return { x: c.x, y: r.y, pos: Position.Top, normal: { x: 0, y: -1 } };
  const sx = r.w / 2 / Math.abs(dx || 1e-9);
  const sy = r.h / 2 / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  const pos =
    sx < sy ? (dx > 0 ? Position.Right : Position.Left) : dy > 0 ? Position.Bottom : Position.Top;
  return { x: c.x + dx * s, y: c.y + dy * s, pos, normal: normalOf(pos) };
}

function anchorOn(n: InternalNode, towards: XY): Anchor {
  const round = roundOf(n);
  if (!round) return borderAnchor(n, towards);
  const o = n.internals.positionAbsolute;
  const a = circleAnchor(o.x + round.cx, o.y + round.cy, round.r, towards);
  return { x: a.x, y: a.y, pos: positionOf(a.nx, a.ny), normal: { x: a.nx, y: a.ny } };
}

export interface AnchoredParams {
  sx: number;
  sy: number;
  sourcePos: Position;
  sourceNormal: XY;
  tx: number;
  ty: number;
  targetPos: Position;
  targetNormal: XY;
}

export function getAnchoredParams(s: InternalNode, t: InternalNode): AnchoredParams {
  const a = anchorOn(s, centreOf(t));
  const b = anchorOn(t, centreOf(s));
  return {
    sx: a.x,
    sy: a.y,
    sourcePos: a.pos,
    sourceNormal: a.normal,
    tx: b.x,
    ty: b.y,
    targetPos: b.pos,
    targetNormal: b.normal,
  };
}

/** A point just outside an anchor, along its normal. */
export function offsetFrom(p: XY, normal: XY, distance: number): XY {
  return { x: p.x + normal.x * distance, y: p.y + normal.y * distance };
}
