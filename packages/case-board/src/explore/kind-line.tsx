import * as React from "react";
import { EXPLORE_KIND_DASH, EXPLORE_KIND_STROKE, type ExploreKind } from "./model";

/**
 * A kind of connection as the line it is drawn with: the legend mark for
 * toggles, counters and lists, so nobody has to learn a second set of signs.
 */
export function KindLine({ kind, muted = false, width = 18 }: { kind: ExploreKind; muted?: boolean; width?: number }) {
  return (
    <svg width={width} height="6" className="shrink-0" aria-hidden>
      <line
        x1="1"
        y1="3"
        x2={width - 1}
        y2="3"
        stroke={muted ? "var(--border)" : EXPLORE_KIND_STROKE[kind]}
        strokeWidth="2"
        strokeDasharray={EXPLORE_KIND_DASH[kind]}
      />
    </svg>
  );
}
