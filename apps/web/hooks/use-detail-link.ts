"use client";

import * as React from "react";
import { useNsPath } from "@/lib/ns-path";

/** Anchor props for a namespace-scoped detail link. */
export interface DetailLinkProps {
  href: string;
  target?: "_blank";
  rel?: "noreferrer";
}

/**
 * Build anchor props for drilling into a detail page (source, document,
 * finding) from an exploratory view like the duplicates graph.
 *
 * The detail opens in a new tab so the operator keeps their place in the graph:
 * these views are expensive to rebuild, and losing the layout to a back button
 * is what makes an exploratory pass feel like work.
 */
export function useDetailLink(): (path: string) => DetailLinkProps {
  const nsPath = useNsPath();

  return React.useCallback(
    (path: string): DetailLinkProps => ({
      href: nsPath(path),
      target: "_blank",
      rel: "noreferrer",
    }),
    [nsPath],
  );
}
