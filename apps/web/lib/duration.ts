export type DurationBreakdown = {
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
};

/**
 * Break a duration in milliseconds into hours / minutes / seconds.
 * Returns null for nullish or non-positive input. Pure math only — no labels,
 * so it can back both translated and untranslated renderers.
 */
export function breakdownDuration(ms?: number | null): DurationBreakdown | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    totalSeconds,
  };
}
