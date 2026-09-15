/**
 * Reading a run's per-asset detector outcomes into "what failed" and "what the
 * CLI switched off".
 *
 * The CLI's breaker (apps/cli/src/pipeline/detector_breaker.py) disables a
 * detector for the rest of a run after a non-retryable provider refusal, too
 * many consecutive failures, or a spent time budget. Every asset it then skips
 * still reports an ERROR outcome — that keeps the asset's findings and keeps it
 * out of the scan cache — with an error starting `breaker_open[<cause>]`.
 *
 * Counting those as ordinary failures reads "fb_solvency_outlook failed on 451
 * of 451 assets", which is exactly what the run said before the breaker existed
 * and hides the only useful fact: the detector stopped on purpose, after one
 * refusal, and the assets will be retried. So they are reported apart.
 */

const BREAKER_OUTCOME = /^breaker_open\[([a-z_]+)\]:\s*([\s\S]*)$/;

const CAUSE_LABELS: Record<string, string> = {
  provider_refused: 'the AI provider refused the request',
  consecutive_failures: 'too many consecutive failures',
  wall_clock_budget: 'its time budget was spent',
};

export interface DetectorDegradation {
  /** Custom detector key, or detector type for built-ins. */
  detector: string;
  /** `provider_refused` | `consecutive_failures` | `wall_clock_budget`. */
  cause: string;
  /** The CLI's own explanation, e.g. the provider's refusal message. */
  reason: string;
  /** Assets this detector did not evaluate this run; retried on the next. */
  assetsSkipped: number;
}

export interface OutcomeFailureSummary {
  /** Assets on which some detector genuinely failed (not skipped). */
  assetCount: number;
  detectorLabels: string[];
  degraded: DetectorDegradation[];
}

function detectorLabel(outcome: Record<string, unknown>): string {
  const { detector_type, custom_detector_key } = outcome;
  if (typeof custom_detector_key === 'string' && custom_detector_key) {
    return custom_detector_key;
  }
  return typeof detector_type === 'string' && detector_type
    ? detector_type
    : 'unknown detector';
}

/** The explanation after the CLI's " — ", or the whole message. */
function breakerReason(message: string): string {
  const separator = message.indexOf(' — ');
  const reason = separator >= 0 ? message.slice(separator + 3) : message;
  return reason.trim().slice(0, 500);
}

export function summarizeOutcomeFailures(
  rows: Array<{ assetHash: string; detectorOutcomes: unknown }>,
): OutcomeFailureSummary {
  const failedAssets = new Set<string>();
  const labels = new Set<string>();
  const degraded = new Map<string, DetectorDegradation>();

  for (const row of rows) {
    if (!Array.isArray(row.detectorOutcomes)) continue;
    for (const raw of row.detectorOutcomes) {
      if (!raw || typeof raw !== 'object') continue;
      const outcome = raw as Record<string, unknown>;
      if (outcome.status !== 'ERROR') continue;

      const label = detectorLabel(outcome);
      const error = typeof outcome.error === 'string' ? outcome.error : '';
      const breaker = BREAKER_OUTCOME.exec(error);
      if (breaker) {
        const entry = degraded.get(label) ?? {
          detector: label,
          cause: breaker[1],
          reason: breakerReason(breaker[2]),
          assetsSkipped: 0,
        };
        entry.assetsSkipped += 1;
        degraded.set(label, entry);
        continue;
      }

      failedAssets.add(row.assetHash);
      labels.add(label);
    }
  }

  return {
    assetCount: failedAssets.size,
    detectorLabels: [...labels].sort(),
    degraded: [...degraded.values()].sort((a, b) =>
      a.detector.localeCompare(b.detector),
    ),
  };
}

/** One sentence per disabled detector, for the run's warning message. */
export function describeDegradation(
  degraded: DetectorDegradation[],
  totalAssets: number,
): string[] {
  return degraded.map((entry) => {
    const cause = CAUSE_LABELS[entry.cause] ?? entry.cause;
    return (
      `${entry.detector} was disabled mid-run because ${cause}; it skipped ` +
      `${entry.assetsSkipped} of ${totalAssets} assets, which keep their ` +
      `findings and are retried next run (${entry.reason})`
    );
  });
}
