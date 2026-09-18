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
 * when the reader asked for reduced motion. The pool comes from the t18n
 * dictionaries (`findingTags`, English fallback per key) — pass the page's
 * locale list so German boards cycle German labels.
 */
export function useCyclingTags(
  slots: number,
  tags: readonly string[] = FINDING_TAGS,
  periodMs = 4200,
): string[] {
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
          tags[(slot * 5 + tick) % tags.length] ?? tags[0] ?? "",
      ),
    [slots, tags, tick],
  );
}
