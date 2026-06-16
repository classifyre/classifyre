"use client";

import type { GraphNodeDto } from "@workspace/api-client";

/**
 * SVG path data extracted from lucide-react icons.
 * Parsed once into Path2D and cached — per-frame cost is just ctx.stroke().
 */
const ICON_PATHS: Record<string, string> = {
  file: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z M14 2v5a1 1 0 0 0 1 1h5",
  fileText: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z M14 2v5a1 1 0 0 0 1 1h5 M10 9H8 M16 13H8 M16 17H8",
  image: "M5 3 L19 3 A2 2 0 0 1 21 5 L21 19 A2 2 0 0 1 19 21 L5 21 A2 2 0 0 1 3 19 L3 5 A2 2 0 0 1 5 3 Z M9 7 a2 2 0 1 1 0 4 a2 2 0 1 1 0 -4 m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
  messageSquare: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
  mail: "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7 M4 4 L20 4 A2 2 0 0 1 22 6 L22 18 A2 2 0 0 1 20 20 L4 20 A2 2 0 0 1 2 18 L2 6 A2 2 0 0 1 4 4 Z",
  paperclip: "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551",
  link2: "M9 17H7A5 5 0 0 1 7 7h2 M15 7h2a5 5 0 1 1 0 10h-2 M8 12 L16 12",
  table: "M12 3v18 M5 3 L19 3 A2 2 0 0 1 21 5 L21 19 A2 2 0 0 1 19 21 L5 21 A2 2 0 0 1 3 19 L3 5 A2 2 0 0 1 5 3 Z M3 9h18 M3 15h18",
  database: "M12 2 A9 3 0 1 1 0 6 A9 3 0 1 1 0 -6 M3 5V19A9 3 0 0 0 21 19V5 M3 12A9 3 0 0 0 21 12",
  notebook: "M2 6h4 M2 10h4 M2 14h4 M2 18h4 M6 2 L18 2 A2 2 0 0 1 20 4 L20 20 A2 2 0 0 1 18 22 L6 22 A2 2 0 0 1 4 20 L4 4 A2 2 0 0 1 6 2 Z M16 2v20",
  workflow: "M5 3 L9 3 A2 2 0 0 1 11 5 L11 9 A2 2 0 0 1 9 11 L5 11 A2 2 0 0 1 3 9 L3 5 A2 2 0 0 1 5 3 Z M7 11v4a2 2 0 0 0 2 2h4 M15 13 L19 13 A2 2 0 0 1 21 15 L21 19 A2 2 0 0 1 19 21 L15 21 A2 2 0 0 1 13 19 L13 15 A2 2 0 0 1 15 13 Z",
  hash: "M4 9 L20 9 M4 15 L20 15 M10 3 L8 21 M16 3 L14 21",
  video: "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5 M4 6 L14 6 A2 2 0 0 1 16 8 L16 16 A2 2 0 0 1 14 18 L4 18 A2 2 0 0 1 2 16 L2 8 A2 2 0 0 1 4 6 Z",
  flaskConical: "M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2 M6.453 15h11.094 M8.5 2h7",
  folder: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  gitBranch: "M15 6a9 9 0 0 0-9 9V3 M18 3 a3 3 0 1 1 0 6 a3 3 0 1 1 0 -6 M6 15 a3 3 0 1 1 0 6 a3 3 0 1 1 0 -6",
  circleAlert: "M12 2 a10 10 0 1 1 0 20 a10 10 0 1 1 0 -20 M12 8 L12 12 M12 16 L12.01 16",
  search: "m21 21-4.34-4.34 M11 3 a8 8 0 1 1 0 16 a8 8 0 1 1 0 -16",
  messageCircle: "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719",
};

const cache = new Map<string, Path2D>();

function getPath(key: string): Path2D | null {
  const src = ICON_PATHS[key];
  if (!src) return null;
  let p2 = cache.get(key);
  if (!p2) {
    p2 = new Path2D(src);
    cache.set(key, p2);
  }
  return p2;
}

/** Map asset type → lucide icon key (mirrors the old getAssetKindIcon()). */
const assetIconKey: Record<string, string> = {
  file: "file",
  image: "image",
  page: "fileText",
  post: "fileText",
  comment: "messageSquare",
  comments: "messageSquare",
  message: "messageSquare",
  email: "mail",
  issue: "fileText",
  attachment: "paperclip",
  linked_file: "link2",
  table: "table",
  data_source: "database",
  collection: "database",
  notebook: "notebook",
  pipeline: "workflow",
  label: "hash",
  item: "file",
  video: "video",
  sandbox: "flaskConical",
};

function drawLucideIcon(
  ctx: CanvasRenderingContext2D,
  key: string,
  cx: number,
  cy: number,
  size: number,
) {
  const path = getPath(key);
  if (!path) return;
  const s = size / 24;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-12, -12);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(path);
  ctx.restore();
}

const findingIconKey: Record<string, string> = {
  SECRETS: "search",
  PII: "hash",
  YARA: "search",
  BROKEN_LINKS: "link2",
  CODE_SECURITY: "flaskConical",
  CUSTOM: "flaskConical",
};

export function drawAssetIcon(
  ctx: CanvasRenderingContext2D,
  n: GraphNodeDto,
  cx: number,
  cy: number,
  size: number,
) {
  const kind = (n.assetType ?? "").toLowerCase();
  const key = n.type === "sandbox" ? "sandbox" : (assetIconKey[kind] ?? "file");
  if (!ICON_PATHS[key]) {
    ctx.font = `bold ${Math.max(8, size - 4)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(kind.charAt(0).toUpperCase() || "?", cx, cy + 0.5);
    return;
  }
  drawLucideIcon(ctx, key, cx, cy, size);
}

export function drawFindingIndicator(
  ctx: CanvasRenderingContext2D,
  n: GraphNodeDto,
  cx: number,
  cy: number,
  size: number,
) {
  const key = findingIconKey[n.detectorType ?? ""] ?? "circleAlert";
  drawLucideIcon(ctx, key, cx, cy, size);
}
