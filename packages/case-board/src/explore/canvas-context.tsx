"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import type { ExploreKind, ExploreLane } from "./model";

/** Every word the canvas shows, so the app can translate them and the docs can write them. */
export interface ExploreWords {
  kinds: Record<ExploreKind, string>;
  lanes: Record<ExploreLane, string>;
  /** "2 hops upstream", "1 hop downstream". */
  where: (side: "up" | "down", depth: number) => string;
  /** Hint on a neighbour: a double click dives into it. */
  walk: string;
  /** Lead of the badge on an asset from another source. */
  elsewhere: string;
  /** Badge on an asset a case holds as evidence, and its tooltip lead. */
  caseMark: string;
  inCase: string;
  /** Badge on an asset whose findings a watch answers, and its tooltip lead. */
  watchMark: string;
  watched: string;
  concept: string;
  entity: string;
  /** Hover card of a link someone drew. */
  yours: string;
  zoomIn: string;
  zoomOut: string;
  /** The percentage: back to 100 %. */
  zoomReset: string;
  fit: string;
  zoomSelection: string;
  minimap: string;
}

export const ENGLISH_WORDS: ExploreWords = {
  kinds: {
    lineage: "Lineage",
    links: "Links",
    duplicates: "Same as",
    similar: "Shared values",
    meaning: "Shared concepts",
    alike: "Alike by meaning",
  },
  lanes: {
    duplicates: "Same as",
    similar: "Shared values",
    terms: "Concepts and entities they share",
    meaning: "Also about them",
    alike: "Alike by meaning",
    links: "Referenced",
  },
  where: (side, depth) => `${depth} ${depth === 1 ? "hop" : "hops"} ${side === "up" ? "upstream" : "downstream"}`,
  walk: "Double-click to dive in",
  elsewhere: "From another source",
  caseMark: "CASE",
  inCase: "Evidence in",
  watchMark: "WATCH",
  watched: "Answers",
  concept: "Concept",
  entity: "Entity",
  yours: "Drawn by a person",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomReset: "Back to 100%",
  fit: "Fit to view",
  zoomSelection: "Zoom to selection",
  minimap: "Mini-map",
};

export interface ExploreCanvasState {
  words: ExploreWords;
  iconFor: (assetType: string | null | undefined) => LucideIcon;
  hoveredLinkId: string | null;
  canLink: boolean;
}

const Ctx = React.createContext<ExploreCanvasState | null>(null);

export const ExploreCanvasProvider = Ctx.Provider;

export function useExploreCanvas(): ExploreCanvasState {
  const state = React.useContext(Ctx);
  if (!state) throw new Error("Explore canvas nodes must render inside ExploreCanvas");
  return state;
}
