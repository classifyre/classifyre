import type { TextCoverageDto } from "@workspace/api-client";

export interface TextCoverageSummary {
  /** Extracted / (extracted + empty + engineUnavailable + zeroFrames + failed), clamped to [0, 1]. */
  pct: number;
  /** Rounded whole-percent value for display, e.g. 42. */
  percent: number;
  /** Denominator used for `pct` (excludes notApplicable/unknown). */
  denominator: number;
  /** True when coverage is low enough — and the sample large enough — to warrant a warning. */
  isLow: boolean;
}

/**
 * Summarizes a runner's `textCoverage` breakdown into a single coverage
 * percentage and a "low coverage" flag. Returns `null` when there is no
 * coverage data to summarize (e.g. older runners, or callers whose DTO
 * doesn't carry `textCoverage` at all).
 */
export function summarizeTextCoverage(
  coverage: TextCoverageDto | null | undefined,
): TextCoverageSummary | null {
  if (!coverage) return null;

  const denominator =
    coverage.extracted +
    coverage.empty +
    coverage.engineUnavailable +
    coverage.zeroFrames +
    coverage.failed;

  const pct = coverage.extracted / Math.max(1, denominator);

  return {
    pct,
    percent: Math.round(pct * 100),
    denominator,
    isLow: pct < 0.6 && denominator >= 5,
  };
}
