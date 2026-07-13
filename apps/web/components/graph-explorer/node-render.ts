import { SEVERITY_COLORS } from "./graph-types";
import type { AssetFindingStats, SeverityArc } from "./explorer-types";

/** Fixed severity ordering so donut segments always read worst-first. */
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

/** Convert per-severity counts into proportional donut arcs. */
export function severityArcsOf(stats: AssetFindingStats): SeverityArc[] {
  if (stats.total === 0) return [];
  const keys = [
    ...SEVERITY_ORDER.filter((k) => stats.severityCounts[k]),
    ...Object.keys(stats.severityCounts).filter((k) => !SEVERITY_ORDER.includes(k)),
  ];
  return keys.map((k) => ({
    color: SEVERITY_COLORS[k] ?? SEVERITY_COLORS.INFO!,
    fraction: stats.severityCounts[k]! / stats.total,
  }));
}

/**
 * Severity donut around an asset node: one arc per severity, proportional to
 * its share of the asset's findings, starting at 12 o'clock. Gives a
 * collapsed asset its "how bad is it" signal at a glance.
 */
export function drawSeverityDonut(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  arcs: SeverityArc[],
) {
  if (arcs.length === 0) return;
  ctx.save();
  ctx.lineWidth = 3.5;
  ctx.lineCap = "butt";
  let start = -Math.PI / 2;
  const gap = arcs.length > 1 ? 0.06 : 0;
  for (const arc of arcs) {
    const sweep = arc.fraction * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, start + gap / 2, start + sweep - gap / 2);
    ctx.strokeStyle = arc.color;
    ctx.stroke();
    start += sweep;
  }
  ctx.restore();
}
