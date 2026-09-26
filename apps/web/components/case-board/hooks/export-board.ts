import { getNodesBounds, getViewportForBounds, type Node, type ReactFlowInstance } from "@xyflow/react";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Wait until React Flow has measured every visible node, so nodes that were
 * just brought into the DOM (the canvas only renders what is in view) are
 * drawn, their edges included. Gives up after `timeoutMs`: an image with a
 * node missing beats no image.
 */
export async function untilMeasured(
  rf: Pick<ReactFlowInstance, "getNodes" | "getInternalNode">,
  timeoutMs = 2000,
): Promise<void> {
  const start = performance.now();
  for (;;) {
    await nextFrame();
    const unmeasured = rf.getNodes().some((n) => !n.hidden && !rf.getInternalNode(n.id)?.measured.width);
    if (!unmeasured || performance.now() - start > timeoutMs) break;
  }
  // One more frame for the edges of the nodes measured last.
  await nextFrame();
}

/**
 * Export the whole board as a PNG — the React Flow "download image" pattern:
 * render the viewport element at a transform that fits every node.
 */
export async function exportBoardPng(nodes: Node[], fileName: string): Promise<void> {
  const { toPng } = await import("html-to-image");
  const viewport = document.querySelector<HTMLElement>(".case-board .react-flow__viewport");
  if (!viewport || nodes.length === 0) return;
  const bounds = getNodesBounds(nodes);
  const padding = 60;
  const width = Math.min(8000, Math.max(800, Math.ceil(bounds.width + padding * 2)));
  const height = Math.min(8000, Math.max(600, Math.ceil(bounds.height + padding * 2)));
  const v = getViewportForBounds(bounds, width, height, 0.1, 2, 0.05);
  const background =
    getComputedStyle(document.querySelector(".case-board") ?? document.body).getPropertyValue("--background") ||
    "#ffffff";
  const dataUrl = await toPng(viewport, {
    backgroundColor: background.trim() || "#ffffff",
    width,
    height,
    pixelRatio: 2,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`,
    },
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  a.click();
}

/** A safe file name from a case title. */
export function boardFileName(title: string | undefined, ext: string): string {
  const base = (title ?? "case-board").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `${base || "case-board"}-${stamp}.${ext}`;
}
