const RUNNER_STATUS_BADGE_LABELS = {
  COMPLETED: "Completed",
  RUNNING: "Running",
  PENDING: "Pending",
  ERROR: "Error",
} as const;

const RUNNER_STATUS_BADGE_TONE = {
  COMPLETED: "border-black bg-[#b7ff00] text-black",
  RUNNING: "border-[#b7ff00]/30 bg-[#0b0f0a] text-[#b7ff00]",
  PENDING: "border-border bg-muted text-foreground",
  ERROR: "border-destructive/30 bg-destructive/5 text-destructive",
} as const;

type RunnerStatusBadgeKey = keyof typeof RUNNER_STATUS_BADGE_LABELS;

function isRunnerStatusBadgeKey(value: string): value is RunnerStatusBadgeKey {
  return value in RUNNER_STATUS_BADGE_LABELS;
}

export function getRunnerStatusBadgeLabel(status?: string | null) {
  if (!status) return RUNNER_STATUS_BADGE_LABELS.PENDING;
  if (isRunnerStatusBadgeKey(status)) return RUNNER_STATUS_BADGE_LABELS[status];
  return status;
}

export function getRunnerStatusBadgeTone(status?: string | null) {
  if (!status) return RUNNER_STATUS_BADGE_TONE.PENDING;
  if (isRunnerStatusBadgeKey(status)) return RUNNER_STATUS_BADGE_TONE[status];
  return RUNNER_STATUS_BADGE_TONE.PENDING;
}

export function isRunnerStatusRunning(status?: string | null) {
  return status?.toUpperCase() === "RUNNING";
}
