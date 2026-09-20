import { type TranslationKey } from "@/i18n";
import { STATUS_TONE } from "@/lib/status-tone";

const RUNNER_STATUS_BADGE_LABELS = {
  COMPLETED: "runners.status.completed",
  WARNING: "runners.status.warning",
  RUNNING: "runners.status.running",
  PENDING: "runners.status.pending",
  ERROR: "runners.status.error",
  // An operator's decision, not a failure — a separate label and the
  // "set aside" tone rather than the red one (field report P8).
  STOPPED: "runners.status.stopped",
} as const;

const RUNNER_STATUS_BADGE_TONE = {
  COMPLETED: STATUS_TONE.done,
  WARNING: STATUS_TONE.progress,
  RUNNING: STATUS_TONE.active,
  PENDING: STATUS_TONE.idle,
  ERROR: STATUS_TONE.error,
  STOPPED: STATUS_TONE.archived,
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
  const upper = status.toUpperCase();
  if (isRunnerStatusBadgeKey(upper)) return RUNNER_STATUS_BADGE_TONE[upper];
  return RUNNER_STATUS_BADGE_TONE.PENDING;
}

export function isRunnerStatusRunning(status?: string | null) {
  return status?.toUpperCase() === "RUNNING";
}

export function isRunnerStatusPending(status?: string | null) {
  return status?.toUpperCase() === "PENDING";
}
