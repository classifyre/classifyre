import * as React from "react";

/**
 * Shared vocabulary for the landing's string boards (hero + closing CTA).
 * Nodes are findings, not sources — the signals Classifyre detectors raise.
 */
export const FINDING_TAGS: readonly string[] = [
  "leaked email",
  "credit card",
  "invalid balance",
  "exposed secret",
  "wrong address",
  "leaked credential",
  "insolvency",
  "unpaid invoice",
  "expired contract",
  "sanctioned entity",
  "stale export",
  "orphaned account",
  "missing consent",
  "duplicate vendor",
];

/**
 * Rotates `slots` labels through the pool on an interval so the boards never
 * show the same set twice. Deterministic on first render (SSR-safe); frozen
 * when the reader asked for reduced motion.
 */
export function useCyclingTags(slots: number, periodMs = 4200): string[] {
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(
      () => setTick((current) => current + 1),
      periodMs,
    );
    return () => window.clearInterval(id);
  }, [periodMs]);

  return React.useMemo(
    () =>
      Array.from(
        { length: slots },
        (_, slot) =>
          FINDING_TAGS[(slot * 5 + tick) % FINDING_TAGS.length] ??
          FINDING_TAGS[0] ??
          "",
      ),
    [slots, tick],
  );
}
