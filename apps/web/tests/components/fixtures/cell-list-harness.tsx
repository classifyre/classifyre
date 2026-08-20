"use client";

import * as React from "react";
import { CellList } from "@/components/notebook/cell-list";
import { AiHealthProvider } from "@/components/ai-health";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { ServerConfigContext } from "@/components/server-config-provider";
import type { NotebookCell } from "@/lib/notebook-cells";

/** Holds cell state so a component test can drive the list and read it back. */
export function CellListHarness({
  initialCells,
  runnable = false,
  clipped = false,
  ai,
}: {
  initialCells: NotebookCell[];
  runnable?: boolean;
  ai?: {
    packages: Array<{ name: string; version?: string }>;
    variables: Record<string, string>;
    secretKeys: string[];
  };
  /**
   * Wrap the cells in an overflow-hidden box, the way the real source form
   * does (cards inside a stepper inside a scrolling page). Without one, a
   * suggestion list overflows freely and a clipping bug cannot show up.
   */
  clipped?: boolean;
}) {
  const [cells, setCells] = React.useState(initialCells);
  const [ran, setRan] = React.useState<string>("");

  const body = (
    <div>
      <pre data-testid="cell-ids">{cells.map((cell) => cell.id).join(",")}</pre>
      <pre data-testid="cell-count">{String(cells.length)}</pre>
      <pre data-testid="ran-cell">{ran}</pre>
      <pre data-testid="cell-sources">
        {cells.map((cell) => `${cell.id}:${cell.source}`).join("\n")}
      </pre>
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
          ai={ai}
        />
      </div>
    </div>
  );

  if (!ai) return body;

  // The AI button reads the real health context, so the harness supplies the
  // real provider. The test stubs the provider endpoints to decide its verdict.
  return (
    <ServerConfigContext.Provider
      value={{ s3Configured: false, demoMode: false }}
    >
      <AiHealthProvider>
        <ConfigureAi />
        {body}
      </AiHealthProvider>
    </ServerConfigContext.Provider>
  );
}

/**
 * Points instance settings at a harness AI provider.
 *
 * The settings fetch does not resolve under component tests, so the health
 * provider would otherwise sit at "loading" forever. This takes the same route
 * the real settings UI does, and the test stubs the PUT behind it.
 */
function ConfigureAi() {
  const { updateSettings } = useInstanceSettings();
  return (
    <button
      type="button"
      data-testid="configure-ai"
      onClick={() =>
        void updateSettings({ harnessAiProviderConfigId: "p1" }).catch(
          () => undefined,
        )
      }
    >
      configure ai
    </button>
  );
}
