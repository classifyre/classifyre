import { type TranslationKey } from "@/i18n";

const CASE_STATUS_BADGE_LABELS = {
  OPEN: "cases.statusLabels.OPEN",
  IN_PROGRESS: "cases.statusLabels.IN_PROGRESS",
  CLOSED: "cases.statusLabels.CLOSED",
  ARCHIVED: "cases.statusLabels.ARCHIVED",
} as const satisfies Record<string, TranslationKey>;

const CASE_STATUS_BADGE_TONE = {
  OPEN: "border-accent/30 bg-background text-accent",
  IN_PROGRESS:
    "border-orange-500/30 bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400",
  CLOSED: "border-border bg-accent text-accent-foreground",
  ARCHIVED: "border-border bg-muted text-muted-foreground",
} as const;

type CaseStatusKey = keyof typeof CASE_STATUS_BADGE_LABELS;

function isCaseStatusKey(value: string): value is CaseStatusKey {
  return value in CASE_STATUS_BADGE_LABELS;
}

export function getCaseStatusBadgeLabel(status?: string | null): TranslationKey {
  if (!status) return CASE_STATUS_BADGE_LABELS.OPEN;
  const upper = status.toUpperCase();
  if (isCaseStatusKey(upper)) return CASE_STATUS_BADGE_LABELS[upper];
  return CASE_STATUS_BADGE_LABELS.OPEN;
}

export function getCaseStatusBadgeTone(status?: string | null): string {
  if (!status) return CASE_STATUS_BADGE_TONE.OPEN;
  const upper = status.toUpperCase();
  if (isCaseStatusKey(upper)) return CASE_STATUS_BADGE_TONE[upper];
  return CASE_STATUS_BADGE_TONE.OPEN;
}
