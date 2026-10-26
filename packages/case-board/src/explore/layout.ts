/**
 * Where everything on the Explore canvas stands. Deterministic and pure: the
 * same graph and the same kinds give the same picture, there is no physics
 * to settle, and it can be tested without a canvas.
 *
 * The seeds stand in a column in the middle. Lineage reads left to right:
 * what feeds them in columns to their left, one per hop, what they feed to
 * their right. Everything sideways sits in labelled lanes: above the seeds
 * what is the same as them (duplicates, shared values), below them the terms
 * they share, the assets those terms bring in, the look-alikes and the plain
 * references. A lane wraps into rows, so it never grows wider than the view.
 */

import { ASSET_NODE, type XY } from "../lib/geometry";
import {
  termNodeId,
  type ExploreAsset,
  type ExploreGraph,
  type ExploreKind,
  type ExploreLane,
  type ExploreLaneLabel,
  type ExploreLink,
  type ExploreTerm,
} from "./model";

export const TERM_CHIP = { width: 176, height: 34 } as const;

/** Centre-to-centre distances. */
const COL = 260;
const ROW = 124;
const SLOT = 196;
const TERM_SLOT = TERM_CHIP.width + 28;
const TERM_ROW = 64;
const PER_ROW = 6;
/** Starting points per row: a few stand side by side, many wrap. */
const SEED_PER_ROW = 4;
const LANE_GAP = 64;
/** Room above a lane's first row for its label. */
const LABEL_SPACE = 30;

const ABOVE: readonly ExploreLane[] = ["duplicates", "similar"];
const BELOW: readonly ExploreLane[] = ["terms", "meaning", "alike", "links"];
/** The lane a sideways asset takes: the first of its kinds in this order. */
const LANE_ORDER: readonly ExploreKind[] = ["duplicates", "similar", "meaning", "alike", "links", "lineage"];

export interface ExploreLayout {
  assets: ExploreAsset[];
  terms: ExploreTerm[];
  links: ExploreLink[];
  /** Top-left corner of each drawn asset and term node (terms keyed `term:<id>`). */
  positions: Map<string, XY>;
  lanes: ExploreLaneLabel[];
  /** The term the canvas is about, when it has one. */
  anchor?: string | null;
}

/**
 * What the chosen kinds leave on the canvas: the seeds, every asset one of
 * those kinds reached (and that a line still touches), the terms that tie
 * two or more of them together, and the lines between what is left. An
 * asset only another kind reached stays hidden, even when a line of a chosen
 * kind runs to it.
 */
export function visibleGraph(graph: ExploreGraph, kinds: ReadonlySet<ExploreKind>): ExploreGraph {
  const anchor = graph.anchor ? termNodeId(graph.anchor) : null;
  const toAnchor = (l: ExploreLink) => anchor !== null && (l.target === anchor || l.source === anchor);
  let links = graph.links.filter((l) => kinds.has(l.kind) || toAnchor(l));
  const degree = new Map<string, number>();
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  // A term ties two assets together, or says what a starting point is about.
  const seeds = new Set(graph.assets.filter((a) => a.side === "seed").map((a) => a.id));
  const seedTerms = new Set(links.filter((l) => seeds.has(l.source) && l.target.startsWith("term:")).map((l) => l.target));
  const terms = graph.terms.filter(
    (t) => (degree.get(termNodeId(t.id)) ?? 0) >= 2 || seedTerms.has(termNodeId(t.id)) || termNodeId(t.id) === anchor,
  );
  const termIds = new Set(terms.map((t) => termNodeId(t.id)));
  links = links.filter((l) => (!l.source.startsWith("term:") || termIds.has(l.source)) && (!l.target.startsWith("term:") || termIds.has(l.target)));
  const touched = new Set(links.flatMap((l) => [l.source, l.target]));
  const carriers = new Set(links.filter(toAnchor).map((l) => (l.target === anchor ? l.source : l.target)));
  const assets = graph.assets.filter(
    (a) => a.side === "seed" || (touched.has(a.id) && (a.kinds.some((k) => kinds.has(k)) || carriers.has(a.id))),
  );
  const assetIds = new Set(assets.map((a) => a.id));
  links = links.filter((l) => (assetIds.has(l.source) || termIds.has(l.source)) && (assetIds.has(l.target) || termIds.has(l.target)));
  return { assets, terms, links, anchor: graph.anchor };
}

export function layoutExplore(graph: ExploreGraph, kinds: ReadonlySet<ExploreKind>): ExploreLayout {
  const shown = visibleGraph(graph, kinds);
  const positions = new Map<string, XY>();
  const lanes: ExploreLaneLabel[] = [];
  const placeAsset = (id: string, centre: XY) =>
    positions.set(id, { x: centre.x - ASSET_NODE.cx, y: centre.y - ASSET_NODE.cy });

  const byLabel = (a: ExploreAsset, b: ExploreAsset) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  const seeds = shown.assets.filter((a) => a.side === "seed");
  const directed = kinds.has("lineage") || kinds.has("links");
  const columns = new Map<string, ExploreAsset[]>();
  const sideways = new Map<ExploreLane, ExploreAsset[]>();
  for (const a of shown.assets) {
    if (a.side === "seed") continue;
    if (directed && (a.side === "up" || a.side === "down")) {
      const key = `${a.side}:${a.depth}`;
      columns.set(key, [...(columns.get(key) ?? []), a]);
      continue;
    }
    const kind = LANE_ORDER.find((k) => kinds.has(k) && a.kinds.includes(k)) ?? "links";
    const lane: ExploreLane = kind === "lineage" ? "links" : kind;
    sideways.set(lane, [...(sideways.get(lane) ?? []), a]);
  }

  // Who is linked to whom, to order each lane by where its partners stand.
  const partners = new Map<string, string[]>();
  for (const l of shown.links) {
    partners.set(l.source, [...(partners.get(l.source) ?? []), l.target]);
    partners.set(l.target, [...(partners.get(l.target) ?? []), l.source]);
  }
  const centreX = (id: string): number | null => {
    const p = positions.get(id);
    if (!p) return null;
    return id.startsWith("term:") ? p.x + TERM_CHIP.width / 2 : p.x + ASSET_NODE.cx;
  };
  /** The mean x of what a node is linked to and already placed: lines then run short and straight. */
  const barycentre = (id: string): number => {
    const xs = (partners.get(id) ?? []).map(centreX).filter((x): x is number => x !== null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  };
  const byBarycentre = <T>(items: T[], idOf: (item: T) => string, tie: (a: T, b: T) => number) =>
    items
      .map((item) => ({ item, x: barycentre(idOf(item)) }))
      .sort((a, b) => a.x - b.x || tie(a.item, b.item))
      .map(({ item }) => item);

  // The band in the middle: the seeds in rows, the lineage columns either side.
  const seedRows: ExploreAsset[][] = [];
  for (let i = 0; i < seeds.length; i += SEED_PER_ROW) seedRows.push(seeds.slice(i, i + SEED_PER_ROW));
  seedRows.forEach((row, r) => {
    const y = (r - (seedRows.length - 1) / 2) * ROW;
    row.forEach((a, i) => placeAsset(a.id, { x: (i - (row.length - 1) / 2) * SLOT, y }));
  });
  const seedHalfWidth = ((Math.min(seeds.length, SEED_PER_ROW) - 1) / 2) * SLOT;
  let tallest = seedRows.length;
  for (const [key, list] of columns) {
    const [side, depth] = key.split(":") as ["up" | "down", string];
    list.sort(byLabel);
    const x = (side === "up" ? -1 : 1) * (seedHalfWidth + Number(depth) * COL);
    list.forEach((a, i) => placeAsset(a.id, { x, y: (i - (list.length - 1) / 2) * ROW }));
    tallest = Math.max(tallest, list.length);
  }
  const bandHalf = ((tallest - 1) / 2) * ROW + ASSET_NODE.height / 2;

  // Terms that tie the most first when nothing is placed to order them by.
  const termDegree = new Map<string, number>();
  for (const l of shown.links) {
    if (l.target.startsWith("term:")) termDegree.set(l.target, (termDegree.get(l.target) ?? 0) + 1);
  }
  const byDegree = (a: ExploreTerm, b: ExploreTerm) =>
    (termDegree.get(termNodeId(b.id)) ?? 0) - (termDegree.get(termNodeId(a.id)) ?? 0) || a.name.localeCompare(b.name);
  let terms = [...shown.terms].sort(byDegree);

  /**
   * Lay a lane out in rows from `edge` outwards (`dir` -1 up, +1 down);
   * returns the far edge of the lane.
   */
  const lane = (
    name: ExploreLane,
    ids: string[],
    edge: number,
    dir: 1 | -1,
    item: { slot: number; row: number; height: number; place: (id: string, centre: XY) => void },
  ): number => {
    if (!ids.length) return edge;
    const rows: string[][] = [];
    for (let i = 0; i < ids.length; i += PER_ROW) rows.push(ids.slice(i, i + PER_ROW));
    const height = LABEL_SPACE + (rows.length - 1) * item.row + item.height;
    const top = dir === 1 ? edge + LANE_GAP : edge - LANE_GAP - height;
    rows.forEach((row, r) => {
      const y = top + LABEL_SPACE + r * item.row + item.height / 2;
      // A row of odd length would put its middle node straight above or below
      // the seeds, and its line would run under the names: stagger it.
      const shift = row.length % 2 === 1 ? item.slot / 2 : 0;
      row.forEach((id, i) => item.place(id, { x: (i - (row.length - 1) / 2) * item.slot + shift, y }));
    });
    const widest = Math.min(ids.length, PER_ROW);
    lanes.push({ lane: name, position: { x: -((widest - 1) / 2) * item.slot - item.slot / 2 + 12, y: top } });
    return dir === 1 ? top + height : top;
  };
  const assetItem = { slot: SLOT, row: ROW, height: ASSET_NODE.height, place: placeAsset };
  const termItem = {
    slot: TERM_SLOT,
    row: TERM_ROW,
    height: TERM_CHIP.height,
    place: (id: string, c: XY) => positions.set(id, { x: c.x - TERM_CHIP.width / 2, y: c.y - TERM_CHIP.height / 2 }),
  };

  // Lanes are placed outwards from the band, each ordered by where what it
  // links to already stands, so a lane's lines fan out instead of crossing.
  const laneAssets = (name: ExploreLane) =>
    byBarycentre(sideways.get(name) ?? [], (a) => a.id, byLabel).map((a) => a.id);
  let up = -bandHalf;
  for (const name of ABOVE) {
    up = lane(name, laneAssets(name), up, -1, assetItem);
  }
  let down = bandHalf;
  for (const name of BELOW) {
    if (name === "terms") {
      terms = byBarycentre(terms, (t) => termNodeId(t.id), byDegree);
      down = lane(name, terms.map((t) => termNodeId(t.id)), down, 1, termItem);
    } else {
      down = lane(name, laneAssets(name), down, 1, assetItem);
    }
  }

  return { ...shown, terms, positions, lanes };
}
