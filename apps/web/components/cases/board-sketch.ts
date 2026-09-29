import {
  ASSET_NODE,
  BOARD_COLORS,
  FINDING_NODE,
  FRAME_TITLE_HEIGHT,
  type BoardColor,
  type BoardSketch,
  type BoardSketchEdgeStyle,
  type BoardSketchNode,
  type BoardSketchSeverity,
} from "@workspace/schemas/case-board";
import { FINDING_SEVERITY_COLOR_BY_LEVEL } from "@workspace/ui/lib/finding-severity";

/**
 * Draw a board sketch (BoardSketch) onto a 2D canvas, in the board's own
 * visual language: assets as outlined circles in the lime "in the case" ring,
 * findings as dots in their severity's colour, notes in their colours,
 * hypothesis cards with their colour bar, frames as tinted dashed regions.
 *
 * Sizes have floors, so a crowded board still reads as structure rather than
 * dust; text is drawn only where it would be legible.
 */

export interface SketchPalette {
  ground: string;
  ink: string;
  card: string;
  evidence: string;
  edge: string;
  manual: string;
  supports: string;
  contradicts: string;
  neutral: string;
  violet: string;
  blue: string;
  strong: Record<BoardColor, string>;
  soft: Record<BoardColor, string>;
  severity: Record<BoardSketchSeverity, string>;
  mono: string;
  sans: string;
}

/** Light-theme values of the board's tokens, for a page that lacks them. */
const FALLBACK_STRONG: Record<BoardColor, string> = {
  yellow: "#eab308",
  blue: "#2563eb",
  green: "#16a34a",
  pink: "#db2777",
  gray: "#737373",
  red: "#dc2626",
  amber: "#d97706",
  violet: "#7c3aed",
};
const FALLBACK_SOFT: Record<BoardColor, string> = {
  yellow: "#fef9c3",
  blue: "#dbeafe",
  green: "#dcfce7",
  pink: "#fce7f3",
  gray: "#f0f0f0",
  red: "#fee2e2",
  amber: "#fef3c7",
  violet: "#ede9fe",
};

/** The board's tokens as they resolve on `el`, so the sketch follows the theme. */
export function readSketchPalette(el: Element): SketchPalette {
  const css = getComputedStyle(el);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const strong = {} as Record<BoardColor, string>;
  const soft = {} as Record<BoardColor, string>;
  for (const color of BOARD_COLORS) {
    strong[color] = token(`--cb-${color}`, FALLBACK_STRONG[color]);
    soft[color] = token(`--cb-${color}-soft`, FALLBACK_SOFT[color]);
  }
  return {
    ground: token("--background", "#f5f5f5"),
    ink: token("--foreground", "#0a0a0a"),
    card: token("--card", "#ffffff"),
    evidence: token("--cb-evidence", "#65a30d"),
    edge: token("--cb-edge", "#78716c"),
    manual: token("--cb-manual", "#b45309"),
    supports: token("--cb-supports", "#15803d"),
    contradicts: token("--cb-contradicts", "#dc2626"),
    neutral: token("--cb-neutral", "#737373"),
    violet: strong.violet,
    blue: strong.blue,
    strong,
    soft,
    severity: FINDING_SEVERITY_COLOR_BY_LEVEL,
    mono: token("--font-mono", "ui-monospace, monospace"),
    sans: token("--font-sans", "ui-sans-serif, system-ui, sans-serif"),
  };
}

type EdgeInk = "edge" | "ink" | "violet" | "blue" | "manual" | "supports" | "contradicts" | "neutral";

const EDGE_LOOK: Record<BoardSketchEdgeStyle, { ink: EdgeInk; width: number; alpha: number; dash?: number[] }> = {
  c: { ink: "edge", width: 0.75, alpha: 0.5 },
  g: { ink: "edge", width: 0.75, alpha: 0.35, dash: [2, 2] },
  l: { ink: "ink", width: 1, alpha: 0.7 },
  k: { ink: "edge", width: 1, alpha: 0.85 },
  d: { ink: "violet", width: 1, alpha: 0.9 },
  s: { ink: "blue", width: 1, alpha: 0.8, dash: [1.5, 2.5] },
  m: { ink: "manual", width: 1.5, alpha: 1 },
  q: { ink: "manual", width: 1.5, alpha: 1, dash: [4, 3] },
  "+": { ink: "supports", width: 1.25, alpha: 1 },
  "-": { ink: "contradicts", width: 1.25, alpha: 1, dash: [4, 3] },
  "0": { ink: "neutral", width: 1, alpha: 0.9 },
};
/** Relations under links people drew, stances on top. */
const EDGE_ORDER: BoardSketchEdgeStyle[] = ["c", "g", "k", "s", "d", "l", "0", "q", "m", "+", "-"];

/** Tiny boards are not blown up past this: one asset should not fill the card. */
const MAX_SCALE = 0.8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function drawBoardSketch(
  ctx: CanvasRenderingContext2D,
  sketch: BoardSketch,
  width: number,
  height: number,
  p: SketchPalette,
): void {
  ctx.clearRect(0, 0, width, height);
  if (sketch.nodes.length === 0) return;

  const pad = Math.round(Math.min(width, height) * 0.1) + 6;
  const sw = Math.max(1, sketch.w);
  const sh = Math.max(1, sketch.h);
  const s = Math.max(0.001, Math.min((width - 2 * pad) / sw, (height - 2 * pad) / sh, MAX_SCALE));
  const ox = (width - sw * s) / 2;
  const oy = (height - sh * s) / 2;
  const X = (v: number) => ox + v * s;
  const Y = (v: number) => oy + v * s;
  // Strokes thicken a little when the board is drawn large.
  const weight = clamp(s / 0.35, 0.85, 1.6);

  const of = <T extends BoardSketchNode["t"]>(t: T) =>
    sketch.nodes.filter((n): n is Extract<BoardSketchNode, { t: T }> => n.t === t);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const frame of of("r")) {
    const x = X(frame.x);
    const y = Y(frame.y);
    const w = frame.w * s;
    const h = frame.h * s;
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = p.strong[frame.c];
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1;
    ctx.setLineDash(frame.k ? [] : [4, 3]);
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    ctx.setLineDash([]);
    const bar = FRAME_TITLE_HEIGHT * s;
    if (frame.l && bar >= 7 && w >= 40) {
      const size = clamp(bar * 0.42, 7, 11);
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = p.ink;
      ctx.font = `600 ${size}px ${p.mono}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(fit(ctx, frame.l, w - 10), x + 5, y + bar / 2);
    }
  }
  ctx.globalAlpha = 1;

  // Edges run centre to centre, under the shapes that end them.
  const centre = (n: BoardSketchNode) =>
    "w" in n ? { x: X(n.x + n.w / 2), y: Y(n.y + n.h / 2) } : { x: X(n.x), y: Y(n.y) };
  for (const style of EDGE_ORDER) {
    const edges = sketch.edges.filter((e) => e.t === style);
    if (edges.length === 0) continue;
    const look = EDGE_LOOK[style];
    ctx.beginPath();
    for (const e of edges) {
      const a = sketch.nodes[e.a];
      const b = sketch.nodes[e.b];
      if (!a || !b) continue;
      const from = centre(a);
      const to = centre(b);
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
    ctx.globalAlpha = look.alpha;
    ctx.strokeStyle = p[look.ink];
    ctx.lineWidth = look.width * weight;
    ctx.setLineDash(look.dash ?? []);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  for (const note of of("n")) {
    const x = X(note.x);
    const y = Y(note.y);
    const w = note.w * s;
    const h = note.h * s;
    ctx.fillStyle = p.soft[note.c];
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    ctx.globalAlpha = 1;
    if (note.l && w >= 34 && h >= 16) {
      const size = clamp(13 * s, 6.5, 10);
      paragraph(ctx, note.l, { x: x + 3, y: y + 3, w: w - 6, h: h - 6 }, `400 ${size}px ${p.sans}`, size, p.ink);
    }
  }

  for (const card of of("h")) {
    const x = X(card.x);
    const y = Y(card.y);
    const w = card.w * s;
    const h = card.h * s;
    const bar = Math.max(2, 8 * s);
    ctx.globalAlpha = card.o ? 0.55 : 1;
    ctx.fillStyle = p.card;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = Math.max(1, 2 * s);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = card.c;
    ctx.fillRect(x, y, bar, h);
    if (card.l && w >= 50 && h >= 18) {
      const size = clamp(14 * s, 7, 10.5);
      paragraph(ctx, card.l, { x: x + bar + 3, y: y + 3, w: w - bar - 6, h: h - 6 }, `600 ${size}px ${p.sans}`, size, p.ink);
    }
    ctx.globalAlpha = 1;
  }

  const assetR = Math.max(ASSET_NODE.r * s, 2.2);
  const ringR = Math.max(ASSET_NODE.ring * s, assetR + 1.4);
  for (const asset of of("a")) {
    const cx = X(asset.x);
    const cy = Y(asset.y);
    if (asset.h) {
      ctx.globalAlpha = 0.8;
      circle(ctx, cx, cy, ringR + Math.max(7 * s, 2));
      ctx.strokeStyle = p.strong[asset.h];
      ctx.lineWidth = Math.max(5 * s, 1.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    circle(ctx, cx, cy, ringR);
    ctx.strokeStyle = p.evidence;
    ctx.lineWidth = Math.max(2.5 * s, 1);
    ctx.stroke();
    if (asset.d) {
      circle(ctx, cx, cy, assetR + Math.max(2.25 * s, 0.9));
      ctx.strokeStyle = p.severity[asset.d];
      ctx.lineWidth = Math.max(3.5 * s, 1.2);
      ctx.stroke();
    }
    circle(ctx, cx, cy, assetR);
    ctx.fillStyle = p.ground;
    ctx.fill();
    ctx.strokeStyle = asset.m ? p.contradicts : p.ink;
    ctx.lineWidth = Math.max(1.75 * s, 0.8);
    ctx.setLineDash(asset.m ? [3, 2] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    // Where the board puts the asset's kind icon.
    if (assetR >= 5) {
      circle(ctx, cx, cy, assetR * 0.3);
      ctx.fillStyle = p.ink;
      ctx.fill();
    }
    if (asset.l && s >= 0.4) {
      const size = clamp(10.5 * s, 7, 10);
      ctx.font = `500 ${size}px ${p.mono}`;
      ctx.fillStyle = p.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fit(ctx, asset.l, ASSET_NODE.width * s), cx, cy + ringR + 3);
    }
  }

  const findingR = Math.max(FINDING_NODE.r * s, 1.7);
  for (const finding of of("f")) {
    const cx = X(finding.x);
    const cy = Y(finding.y);
    circle(ctx, cx, cy, findingR);
    if (finding.g) {
      ctx.strokeStyle = p.neutral;
      ctx.lineWidth = 0.9;
      ctx.setLineDash([2, 1.5]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (finding.o) {
      ctx.fillStyle = p.ground;
      ctx.fill();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = p.severity[finding.s];
      ctx.lineWidth = Math.max(1.5 * s, 0.8);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = p.severity[finding.s];
      ctx.fill();
      if (findingR >= 3.5) {
        ctx.strokeStyle = p.ground;
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
    }
  }

  for (const pin of of("p")) {
    const r = Math.max(8 * s, 2.5);
    const cx = X(pin.x);
    const cy = Y(pin.y);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.35, cy + r * 0.6);
    ctx.lineTo(cx - r * 0.7, cy + r * 1.35);
    ctx.lineTo(cx + r * 0.2, cy + r * 0.8);
    ctx.closePath();
    circle(ctx, cx, cy, r, false);
    ctx.fillStyle = p.ink;
    ctx.fill();
  }

  ctx.restore();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fresh = true): void {
  if (fresh) ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** `text` cut with an ellipsis to fit `max` pixels in the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : "";
}

/** Word-wrapped text inside a box, as many lines as fit, the last one cut. */
function paragraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: { x: number; y: number; w: number; h: number },
  font: string,
  size: number,
  ink: string,
): void {
  const lineHeight = size * 1.25;
  const maxLines = Math.floor(box.h / lineHeight);
  if (maxLines < 1 || box.w < 10) return;
  ctx.font = font;
  ctx.fillStyle = ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lines: string[] = [];
  let line = "";
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]!;
    if (ctx.measureText(next).width <= box.w || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i]!;
    if (lines.length === maxLines) {
      line = "";
      // The rest does not fit: the last line says so.
      lines[maxLines - 1] = fit(ctx, `${lines[maxLines - 1]} ${words.slice(i).join(" ")}`, box.w);
      break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(fit(ctx, l, box.w), box.x, box.y + i * lineHeight));
}
