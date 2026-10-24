import type { MapNode, SchemeRef } from "@/lib/semantic-api";

/**
 * Where the semantic map (SL5 B2) puts things. Pure, so both layouts are
 * deterministic and testable without a canvas.
 *
 * Taxonomy is one frame per scheme. Inside a frame the scheme's tree reads as
 * an outline: broader above, narrower indented beneath it, biggest first.
 * Frames are packed into the number of columns that lets the whole map be
 * read at the largest zoom in the space it has. A row of bubbles (what a
 * layered layout gives a glossary that is mostly roots) is never the answer.
 */

/** Every concept card is the same size, so a map reads like a list. */
export const CONCEPT_SIZE = { width: 196, height: 42 } as const;

/** A scheme frame's title bar; its concepts start below it. */
export const FRAME_TITLE_HEIGHT = 36;

const INDENT = 18;
/** Deeper concepts stay at this indent so frames keep one width. */
const MAX_INDENT_DEPTH = 3;
const ROW_GAP = 6;
const ROW = CONCEPT_SIZE.height + ROW_GAP;
const FRAME_PAD = 10;
const FRAME_GAP = 24;
/** Packing tries at most this many column heights and column counts. */
const MAX_CANDIDATES = 40;

export interface SchemeFrame {
  /** `scheme:<id>`, or `scheme:none` for concepts without a scheme. */
  id: string;
  scheme: SchemeRef | null;
  x: number;
  y: number;
  width: number;
  height: number;
  conceptIds: string[];
}

export interface PlacedConcept {
  /** Top-left corner on the canvas. */
  x: number;
  y: number;
  depth: number;
  frameId: string;
  /** The broader concept it hangs under in its frame's outline. */
  parentId: string | null;
}

export interface TaxonomyLayout {
  frames: SchemeFrame[];
  concepts: Map<string, PlacedConcept>;
  width: number;
  height: number;
}

export const frameIdOf = (scheme: SchemeRef | null) => `scheme:${scheme?.id ?? "none"}`;

const bySize = (a: MapNode, b: MapNode) =>
  b.totalAssetCount - a.totalAssetCount || a.name.localeCompare(b.name);

interface OutlineRow {
  node: MapNode;
  depth: number;
  parentId: string | null;
}

/**
 * One scheme's concepts as outline rows (depth-first, biggest first), cut
 * into blocks: a root with everything under it, which is never split.
 */
function outline(members: MapNode[]): OutlineRow[][] {
  const inFrame = new Set(members.map((node) => node.termId));
  const children = new Map<string | null, MapNode[]>();
  for (const node of members) {
    const parent = node.broaderIds.find((id) => id !== node.termId && inFrame.has(id)) ?? null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  for (const list of children.values()) list.sort(bySize);
  const blocks: OutlineRow[][] = [];
  const seen = new Set<string>();
  const visit = (node: MapNode, depth: number, parentId: string | null, rows: OutlineRow[]) => {
    if (seen.has(node.termId)) return;
    seen.add(node.termId);
    rows.push({ node, depth, parentId });
    for (const child of children.get(node.termId) ?? []) visit(child, depth + 1, node.termId, rows);
  };
  const start = (root: MapNode) => {
    if (seen.has(root.termId)) return;
    const rows: OutlineRow[] = [];
    visit(root, 0, null, rows);
    blocks.push(rows);
  };
  for (const root of children.get(null) ?? []) start(root);
  // A broader cycle leaves no root: start it from its biggest member.
  for (const node of [...members].sort(bySize)) start(node);
  return blocks;
}

/**
 * Blocks flowed into columns of at most `cap` rows, newspaper style. An empty
 * scheme still gets one (empty) column, so it has a frame to add to.
 */
function flow(blocks: OutlineRow[][], cap: number): OutlineRow[][] {
  if (blocks.length === 0) return [[]];
  const columns: OutlineRow[][] = [];
  let current: OutlineRow[] = [];
  for (const block of blocks) {
    if (current.length > 0 && current.length + block.length > cap) {
      columns.push(current);
      current = [];
    }
    current = current.concat(block);
  }
  if (current.length > 0) columns.push(current);
  return columns;
}

/** Up to `limit` integers spread over [low, high], both ends included. */
function spread(low: number, high: number, limit: number): number[] {
  if (high <= low) return [low];
  const step = Math.max(1, (high - low) / (limit - 1));
  const out = new Set<number>();
  for (let value = low; value < high; value += step) out.add(Math.round(value));
  out.add(high);
  return [...out];
}

interface Packed {
  scale: number;
  cap: number;
  at: Array<{ x: number; y: number }>;
  columns: OutlineRow[][][];
  width: number;
  height: number;
}

/**
 * Masonry over unit columns, where a scheme too tall for the column height
 * flows into several columns side by side. Tries column heights and column
 * counts and keeps the arrangement that fits the viewport at the largest
 * scale (ties go to the one splitting schemes least).
 */
function pack(
  schemes: OutlineRow[][][],
  unitWidth: number,
  viewport: { width: number; height: number },
): Packed {
  const tallest = Math.max(1, ...schemes.map((blocks) => blocks.reduce((n, b) => n + b.length, 0)));
  const longestBlock = Math.max(1, ...schemes.flatMap((blocks) => blocks.map((b) => b.length)));
  let best: Packed | null = null;
  for (const cap of spread(longestBlock, tallest, MAX_CANDIDATES)) {
    const columns = schemes.map((blocks) => flow(blocks, cap));
    const spans = columns.map((c) => c.length);
    const heights = columns.map(
      (c) => FRAME_TITLE_HEIGHT + Math.max(1, ...c.map((rows) => rows.length)) * ROW - ROW_GAP + FRAME_PAD,
    );
    const total = spans.reduce((a, b) => a + b, 0);
    for (const units of spread(Math.max(...spans), total, MAX_CANDIDATES)) {
      const fill = new Array<number>(units).fill(0);
      const at = spans.map((span, index) => {
        let start = 0;
        let top = Infinity;
        for (let s = 0; s + span <= units; s += 1) {
          const y = Math.max(...fill.slice(s, s + span));
          if (y < top) {
            top = y;
            start = s;
          }
        }
        for (let s = start; s < start + span; s += 1) fill[s] = top + heights[index]! + FRAME_GAP;
        return { x: start * (unitWidth + FRAME_GAP), y: top };
      });
      const used = fill.filter((h) => h > 0).length;
      const width = used * unitWidth + (used - 1) * FRAME_GAP;
      const height = Math.max(...fill) - FRAME_GAP;
      const scale = Math.min(viewport.width / width, viewport.height / height);
      if (!best || scale > best.scale * 1.01 || (scale > best.scale * 0.99 && cap > best.cap)) {
        best = { scale, cap, at, columns, width, height };
      }
    }
  }
  return best!;
}

export function taxonomyLayout(
  nodes: MapNode[],
  viewport: { width: number; height: number },
  /** Schemes with no concepts yet: drawn as empty frames, last. */
  emptySchemes: SchemeRef[] = [],
): TaxonomyLayout {
  const groups = new Map<string, { scheme: SchemeRef | null; members: MapNode[] }>();
  for (const scheme of emptySchemes) groups.set(frameIdOf(scheme), { scheme, members: [] });
  for (const node of nodes) {
    const id = frameIdOf(node.scheme);
    const group = groups.get(id) ?? { scheme: node.scheme, members: [] };
    group.members.push(node);
    groups.set(id, group);
  }
  const schemes = [...groups.entries()].map(([id, group]) => ({
    id,
    scheme: group.scheme,
    blocks: outline(group.members),
    // The heaviest scheme first: what the corpus is most about reads first.
    weight: group.members.reduce((max, node) => Math.max(max, node.totalAssetCount), 0),
  }));
  schemes.sort(
    (a, b) =>
      b.weight - a.weight || (a.scheme?.name ?? "").localeCompare(b.scheme?.name ?? ""),
  );
  if (schemes.length === 0) return { frames: [], concepts: new Map(), width: 0, height: 0 };
  const deepest = Math.min(
    MAX_INDENT_DEPTH,
    Math.max(0, ...schemes.flatMap((s) => s.blocks.flat().map((row) => row.depth))),
  );
  const unitWidth = 2 * FRAME_PAD + deepest * INDENT + CONCEPT_SIZE.width;
  const packed = pack(
    schemes.map((s) => s.blocks),
    unitWidth,
    { width: Math.max(320, viewport.width), height: Math.max(240, viewport.height) },
  );
  const frames: SchemeFrame[] = [];
  const concepts = new Map<string, PlacedConcept>();
  schemes.forEach((s, index) => {
    const at = packed.at[index]!;
    const columns = packed.columns[index]!;
    const rows = Math.max(1, ...columns.map((c) => c.length));
    frames.push({
      id: s.id,
      scheme: s.scheme,
      x: at.x,
      y: at.y,
      width: columns.length * unitWidth + (columns.length - 1) * FRAME_GAP,
      height: FRAME_TITLE_HEIGHT + rows * ROW - ROW_GAP + FRAME_PAD,
      conceptIds: columns.flat().map((row) => row.node.termId),
    });
    columns.forEach((column, columnIndex) => {
      const left = at.x + columnIndex * (unitWidth + FRAME_GAP) + FRAME_PAD;
      column.forEach((row, rowIndex) => {
        concepts.set(row.node.termId, {
          x: left + Math.min(row.depth, MAX_INDENT_DEPTH) * INDENT,
          y: at.y + FRAME_TITLE_HEIGHT + rowIndex * ROW,
          depth: row.depth,
          frameId: s.id,
          parentId: row.parentId,
        });
      });
    });
  });
  return { frames, concepts, width: packed.width, height: packed.height };
}

/**
 * Push apart same-sized rectangles (given by their centres) until none
 * overlap, each pair along the axis it overlaps least. A sweep over x keeps
 * it near-linear for maps of a few hundred cards.
 */
export function separateRects(
  centres: Array<{ x: number; y: number }>,
  size: { width: number; height: number },
  gap: number,
  iterations = 80,
): void {
  const w = size.width + gap;
  const h = size.height + gap;
  const order = centres.map((_, index) => index);
  for (let pass = 0; pass < iterations; pass += 1) {
    order.sort((a, b) => centres[a]!.x - centres[b]!.x);
    let moved = false;
    for (let i = 0; i < order.length; i += 1) {
      const a = centres[order[i]!]!;
      for (let j = i + 1; j < order.length; j += 1) {
        const b = centres[order[j]!]!;
        const dx = b.x - a.x;
        if (dx >= w) break;
        const dy = b.y - a.y;
        const overlapX = w - Math.abs(dx);
        const overlapY = h - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        // Normalised by the card's shape, so wide cards slide sideways less.
        if (overlapX / w < overlapY / h) {
          const push = (overlapX / 2 + 0.01) * (dx < 0 ? -1 : 1);
          a.x -= push;
          b.x += push;
        } else {
          const push = (overlapY / 2 + 0.01) * (dy < 0 ? -1 : 1);
          a.y -= push;
          b.y += push;
        }
      }
    }
    if (!moved) return;
  }
}
