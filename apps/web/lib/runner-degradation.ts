/**
 * `runner.errorDetails.detectorsDegraded`, read defensively.
 *
 * The API writes it when the CLI's breaker switched a detector off mid-run: a
 * provider refusal that retrying cannot fix, too many consecutive failures, or
 * a spent time budget. It is split from the rest of `errorDetails` so the scan
 * page can say which detector stopped and why in words, and keep the raw JSON
 * dump for whatever else a failed run carries.
 */
export interface DegradedDetector {
  detector: string;
  cause: string;
  reason: string;
  assetsSkipped: number;
}

/**
 * Breaker causes the UI can name. Anything else (a newer CLI shipping a cause
 * this web build does not know yet) falls back to `other` so the page says
 * something instead of rendering a raw translation key.
 */
const KNOWN_DEGRADED_CAUSES = new Set([
  'provider_refused',
  'consecutive_failures',
  'wall_clock_budget',
]);

export function degradedCauseKey(cause: string): string {
  return KNOWN_DEGRADED_CAUSES.has(cause) ? cause : 'other';
}

function toDegraded(value: unknown): DegradedDetector | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.detector !== "string" || typeof entry.cause !== "string") {
    return null;
  }
  return {
    detector: entry.detector,
    cause: entry.cause,
    reason: typeof entry.reason === "string" ? entry.reason : "",
    assetsSkipped:
      typeof entry.assetsSkipped === "number" && Number.isFinite(entry.assetsSkipped)
        ? entry.assetsSkipped
        : 0,
  };
}

export function splitRunnerErrorDetails(errorDetails: unknown): {
  degraded: DegradedDetector[];
  rest: Record<string, unknown> | null;
} {
  if (!errorDetails || typeof errorDetails !== "object" || Array.isArray(errorDetails)) {
    return { degraded: [], rest: null };
  }
  const { detectorsDegraded, ...rest } = errorDetails as Record<string, unknown>;
  const degraded = Array.isArray(detectorsDegraded)
    ? detectorsDegraded
        .map(toDegraded)
        .filter((entry): entry is DegradedDetector => entry !== null)
    : [];
  return {
    degraded,
    rest: Object.keys(rest).length > 0 ? rest : null,
  };
}
