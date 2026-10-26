/**
 * Explore's graph, as the canvas draws it: assets, the glossary terms that
 * tie some of them together, and the links between them, each with the words
 * that say why. The app builds it from the API; the documentation writes one
 * by hand. Pure: no React.
 */

import type { XY } from "../lib/geometry";

export type ExploreKind = "lineage" | "links" | "duplicates" | "similar" | "meaning" | "alike";

/** The order kinds are listed in, and the order a sideways asset picks its lane by. */
export const EXPLORE_KINDS: readonly ExploreKind[] = ["lineage", "links", "duplicates", "similar", "meaning", "alike"];

export type ExploreSide = "seed" | "up" | "down" | "side";

export interface ExploreAsset {
  id: string;
  label: string;
  /** Catalog asset kind (file, image, table, …) for the icon. */
  assetType?: string | null;
  sourceName?: string | null;
  side: ExploreSide;
  /** Hops from the nearest seed; 0 for a seed. */
  depth: number;
  /** Every kind of connection that reached it. */
  kinds: ExploreKind[];
  /** A URN nothing has scanned yet: drawn, but there is nothing to open. */
  external?: boolean;
  /** From another source than the one explored: marked with its source's name. */
  foreign?: boolean;
  /** Cases it is evidence in, by title. */
  cases?: string[];
  /** Watches (inquiries) its findings answer, by title. */
  watches?: string[];
}

export interface ExploreTerm {
  id: string;
  name: string;
  /** CONCEPT or ENTITY. */
  kind: string;
}

export interface ExploreLink {
  id: string;
  /** Asset id, or `term:<id>` for a term. */
  source: string;
  target: string;
  kind: ExploreKind;
  /** Why: "feeds", "shares person ×2", "84 % alike", what someone wrote. */
  label: string;
  /** Drawn by a person: the only kind that can be removed. */
  manual?: boolean;
  /** Reads one way (lineage, references). */
  directed?: boolean;
  /** 0–1 for scored links; drawn fainter the weaker it is. */
  strength?: number | null;
}

export interface ExploreGraph {
  assets: ExploreAsset[];
  terms: ExploreTerm[];
  links: ExploreLink[];
  /**
   * A term the canvas is about (a glossary term's page): drawn with every
   * asset that carries it, whatever kinds are shown, so the reason the
   * assets are there never disappears.
   */
  anchor?: string | null;
}

export const termNodeId = (termId: string) => `term:${termId}`;

/** What is selected on the canvas. */
export type ExploreSelection =
  | { type: "asset"; id: string }
  | { type: "term"; id: string }
  | { type: "link"; id: string };

/**
 * How each kind's line is drawn, so a legend glyph and the line on the
 * canvas are the same mark: lineage and shared concepts solid, the rest
 * dashed, each its own way.
 */
export const EXPLORE_KIND_DASH: Record<ExploreKind, string | undefined> = {
  lineage: undefined,
  links: "2 3",
  duplicates: "7 4",
  similar: "3 4",
  meaning: undefined,
  alike: "9 3 2 3",
};

/** How each kind is tinted, on the canvas and in the toggles. */
export const EXPLORE_KIND_STROKE: Record<ExploreKind, string> = {
  lineage: "var(--foreground)",
  links: "var(--cb-edge)",
  duplicates: "var(--cb-violet)",
  similar: "var(--cb-blue)",
  meaning: "var(--cb-green)",
  alike: "var(--cb-pink)",
};

/** Lanes the sideways assets and the terms sit in. */
export type ExploreLane = "duplicates" | "similar" | "terms" | "meaning" | "alike" | "links";

export interface ExploreLaneLabel {
  lane: ExploreLane;
  /** Left end of the lane's first row, in flow coordinates. */
  position: XY;
}
