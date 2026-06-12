import * as React from "react";
import { ACCENT, CROSS_HYP_COLOR, MANUAL_EDGE_COLOR } from "./graph-types";

function Arrow({ id, color }: { id: string; color: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
    </marker>
  );
}

/** Shared markers + filters. Colors that must flip with dark mode use CSS vars. */
export function GraphSvgDefs() {
  return (
    <defs>
      <Arrow id="arrow-default" color="var(--muted-foreground)" />
      <Arrow id="arrow-manual" color={MANUAL_EDGE_COLOR} />
      <Arrow id="arrow-cross" color={CROSS_HYP_COLOR} />
      <Arrow id="arrow-path" color={ACCENT} />
      <filter id="node-glow" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor={ACCENT} floodOpacity="0.85" />
      </filter>
      <pattern id="dot-grid" width="26" height="26" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1" fill="var(--muted-foreground)" opacity="0.22" />
      </pattern>
    </defs>
  );
}
