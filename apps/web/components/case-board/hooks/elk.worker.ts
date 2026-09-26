/// <reference lib="webworker" />
import type { ElkNode } from "elkjs/lib/elk-api";

/**
 * ELK in a Web Worker, so laying out a few hundred bubbles never blocks the
 * canvas (the same pattern the graph explorer's force worker uses).
 *
 * elkjs's bundled build runs the layout through an in-process "FakeWorker"
 * from elk-worker.min.js — but that script, seeing a worker global, installs
 * itself as this worker's message handler instead of exporting FakeWorker,
 * and the bundle then fails with "Worker is not a constructor". Presenting a
 * `document` while it loads makes it take the export path; the global is
 * removed again straight after.
 */
type ElkInstance = { layout: (graph: ElkNode) => Promise<ElkNode> };
let elk: Promise<ElkInstance> | null = null;

function loadElk(): Promise<ElkInstance> {
  if (!elk) {
    const scope = self as unknown as { document?: unknown };
    scope.document = {};
    elk = import("elkjs/lib/elk.bundled.js")
      .then((mod) => {
        const ELK = (mod as unknown as { default: new () => ElkInstance }).default;
        return new ELK();
      })
      .finally(() => {
        delete scope.document;
      });
  }
  return elk;
}

interface LayoutRequest {
  id: number;
  graph: ElkNode;
}

self.onmessage = async (event: MessageEvent<LayoutRequest>) => {
  const { id, graph } = event.data;
  try {
    const result = await (await loadElk()).layout(graph);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
