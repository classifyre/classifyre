import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";
import {
  DataRequestSpecSchema,
  type DataRequestSpec,
} from "@workspace/schemas/data-request";

function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function resolveCanvasBackground(element: HTMLElement): string {
  const bg = getComputedStyle(element).getPropertyValue("--background").trim();
  return bg || "#f5f5f5";
}

export interface ExportImageOptions {
  viewportEl: HTMLElement;
  nodes: Node[];
  filename?: string;
  pixelRatio?: 1 | 2;
  monochrome?: boolean;
}

function computeExportDimensions(nodes: Node[]) {
  const bounds = getNodesBounds(nodes);
  const pad = 64;
  const width = Math.max(800, Math.min(4096, Math.ceil(bounds.width + pad * 2)));
  const height = Math.max(600, Math.min(4096, Math.ceil(bounds.height + pad * 2)));
  const viewport = getViewportForBounds(bounds, width, height, 0.25, 2, 0.08);
  return { width, height, viewport };
}

export async function exportDiagramPng({
  viewportEl,
  nodes,
  filename = "visual-schema.png",
  pixelRatio = 1,
  monochrome = false,
}: ExportImageOptions): Promise<void> {
  if (nodes.length === 0) return;
  const { width, height, viewport } = computeExportDimensions(nodes);
  const backgroundColor = monochrome ? "#ffffff" : resolveCanvasBackground(viewportEl);
  const dataUrl = await toPng(viewportEl, {
    backgroundColor,
    width,
    height,
    pixelRatio,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      ...(monochrome ? { filter: "grayscale(1) contrast(1.25)" } : {}),
    },
  });
  downloadDataUrl(dataUrl, filename);
}

export async function exportDiagramSvg({
  viewportEl,
  nodes,
  filename = "visual-schema.svg",
}: Omit<ExportImageOptions, "pixelRatio" | "monochrome">): Promise<void> {
  if (nodes.length === 0) return;
  const { width, height, viewport } = computeExportDimensions(nodes);
  const backgroundColor = resolveCanvasBackground(viewportEl);
  const dataUrl = await toSvg(viewportEl, {
    backgroundColor,
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  });
  downloadDataUrl(dataUrl, filename);
}

export function exportSpecJson(
  spec: DataRequestSpec,
  filename = "visual-schema.json",
): void {
  const payload = JSON.stringify({ version: 1, spec }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  downloadBlob(blob, filename);
}

/**
 * Strictly validate imported JSON via `DataRequestSpecSchema` (z.strictObject),
 * supporting both `{ version: 1, spec }` envelopes and raw specs.
 */
export function parseImportedSpecJson(
  rawText: string,
): { ok: true; spec: DataRequestSpec } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(rawText);
    const candidate =
      parsed &&
      typeof parsed === "object" &&
      "spec" in parsed &&
      (parsed as Record<string, unknown>).spec !== undefined
        ? (parsed as Record<string, unknown>).spec
        : parsed;
    const res = DataRequestSpecSchema.safeParse(candidate);
    if (!res.success) {
      return {
        ok: false,
        error: res.error.issues[0]?.message ?? "Invalid schema specification.",
      };
    }
    return { ok: true, spec: res.data };
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
}
