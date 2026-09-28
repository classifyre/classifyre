/**
 * A case's clean-up switches as the web app handles them. The API owns what
 * they mean (apps/api/src/cases/case-cleanup.rules.ts); this is only their
 * names, order and defaults, shared by the create page and the case file
 * panel.
 */
export const CLEANUP_KEYS = [
  "removeGoneFindings",
  "removeResolvedFindings",
  "removeGoneAssets",
] as const;

export type CleanupKey = (typeof CLEANUP_KEYS)[number];

export type CleanupValues = Record<CleanupKey, boolean>;

export const NO_CLEANUP: CleanupValues = {
  removeGoneFindings: false,
  removeResolvedFindings: false,
  removeGoneAssets: false,
};

export function cleanupOf(
  row: Partial<Record<CleanupKey, boolean | null | undefined>> | null | undefined,
): CleanupValues {
  return {
    removeGoneFindings: row?.removeGoneFindings === true,
    removeResolvedFindings: row?.removeResolvedFindings === true,
    removeGoneAssets: row?.removeGoneAssets === true,
  };
}

/** A literal value as a regular expression that matches exactly it. */
export function exactValuePattern(value: string): string {
  return `^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}
