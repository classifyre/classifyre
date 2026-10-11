import { useCurrentFrame, useVideoConfig } from "remotion";

/*
 * Stands in for apps/blog/components/finding-tags.ts. The landing page rotates
 * the labels on its string boards with setInterval, which is wall-clock time:
 * two renders of one frame would show different labels. Here the same rotation
 * is counted in frames.
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

export function useCyclingTags(
  slots: number,
  tags: readonly string[] = FINDING_TAGS,
  periodMs = 4200,
): string[] {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tick = Math.floor((frame / fps) * (1000 / periodMs));

  return Array.from(
    { length: slots },
    (_, slot) => tags[(slot * 5 + tick) % tags.length] ?? tags[0] ?? "",
  );
}
