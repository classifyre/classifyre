"use client";

import * as React from "react";
import { CellList } from "@/components/notebook/cell-list";
import type { NotebookCell } from "@/lib/notebook-cells";

/** Holds cell state so a component test can drive the list and read it back. */
export function CellListHarness({
  initialCells,
  runnable = false,
  clipped = false,
}: {
  initialCells: NotebookCell[];
  runnable?: boolean;
  /**
   * Wrap the cells in an overflow-hidden box, the way the real source form
   * does (cards inside a stepper inside a scrolling page). Without one, a
   * suggestion list overflows freely and a clipping bug cannot show up.
   */
  clipped?: boolean;
}) {
  const [cells, setCells] = React.useState(initialCells);
  const [ran, setRan] = React.useState<string>("");

  return (
    <div>
      <pre data-testid="cell-ids">{cells.map((cell) => cell.id).join(",")}</pre>
      <pre data-testid="cell-count">{String(cells.length)}</pre>
      <pre data-testid="ran-cell">{ran}</pre>
      <div
        className={clipped ? "overflow-hidden rounded border" : undefined}
        style={clipped ? { height: 180 } : undefined}
        data-testid="clipper"
      >
        <CellList
          notebookId="nb"
          cells={cells}
          onChange={setCells}
          onRunCell={runnable ? (id) => setRan(id) : undefined}
        />
      </div>
    </div>
  );
}
