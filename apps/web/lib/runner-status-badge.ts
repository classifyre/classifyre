import { type TranslationKey } from "@/i18n";
import { STATUS_TONE } from "@/lib/status-tone";

const RUNNER_STATUS_BADGE_LABELS = {
  COMPLETED: "runners.status.completed",
  WARNING: "runners.status.warning",
  RUNNING: "runners.status.running",
  PENDING: "runners.status.pending",
  ERROR: "runners.status.error",
} as const;

const RUNNER_STATUS_BADGE_TONE = {
  COMPLETED: STATUS_TONE.done,
  WARNING: STATUS_TONE.progress,
  RUNNING: STATUS_TONE.active,
  PENDING: STATUS_TONE.idle,
  ERROR: STATUS_TONE.error,
} as const;

type RunnerStatusBadgeKey = keyof typeof RUNNER_STATUS_BADGE_LABELS;

function isRunnerStatusBadgeKey(value: string): value is RunnerStatusBadgeKey {
  return value in RUNNER_STATUS_BADGE_LABELS;
}

export function getRunnerStatusBadgeLabel(status?: string | null): TranslationKey {
  if (!status) return RUNNER_STATUS_BADGE_LABELS.PENDING;
  const upper = status.toUpperCase();
  if (isRunnerStatusBadgeKey(upper)) return RUNNER_STATUS_BADGE_LABELS[upper];
  return RUNNER_STATUS_BADGE_LABELS.PENDING;
}

export function getRunnerStatusBadgeTone(status?: string | null) {
  if (!status) return RUNNER_STATUS_BADGE_TONE.PENDING;
  if (isRunnerStatusBadgeKey(status)) return RUNNER_STATUS_BADGE_TONE[status];
  return RUNNER_STATUS_BADGE_TONE.PENDING;
}

export function isRunnerStatusRunning(status?: string | null) {
  return status?.toUpperCase() === "RUNNING";
}

export function isRunnerStatusPending(status?: string | null) {
  return status?.toUpperCase() === "PENDING";
}
