"use client";

import * as React from "react";

/** What the demo's nodes and edges share: focus, hover, and a line to say what the board would do. */
export interface DemoState {
  focus: string | null;
  setFocus: (id: string | null) => void;
  hoveredEdgeId: string | null;
  /** Shows a short note over the canvas, for actions the demo only describes. */
  say: (message: string) => void;
}

const DemoContext = React.createContext<DemoState>({
  focus: null,
  setFocus: () => {},
  hoveredEdgeId: null,
  say: () => {},
});

export const DemoProvider = DemoContext.Provider;

export function useDemo(): DemoState {
  return React.useContext(DemoContext);
}
