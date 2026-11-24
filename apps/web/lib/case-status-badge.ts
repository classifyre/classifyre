import { type TranslationKey } from "@/i18n";
import { STATUS_TONE } from "@/lib/status-tone";

const CASE_STATUS_BADGE_LABELS = {
  OPEN: "cases.statusLabels.OPEN",
  IN_PROGRESS: "cases.statusLabels.IN_PROGRESS",
  CLOSED: "cases.statusLabels.CLOSED",
  ARCHIVED: "cases.statusLabels.ARCHIVED",
} as const satisfies Record<string, TranslationKey>;

const CASE_STATUS_BADGE_TONE = {
  OPEN: STATUS_TONE.active,
  IN_PROGRESS: STATUS_TONE.progress,
  CLOSED: STATUS_TONE.done,
  ARCHIVED: STATUS_TONE.archived,
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

const DATA_REQUEST_STATE_BADGE_LABELS = {
  DRAFT: "cases.requestStates.DRAFT",
  SUBMITTED: "cases.requestStates.SUBMITTED",
  IN_PROGRESS: "cases.requestStates.IN_PROGRESS",
  CHANGES_REQUESTED: "cases.requestStates.CHANGES_REQUESTED",
  DELIVERED: "cases.requestStates.DELIVERED",
  DECLINED: "cases.requestStates.DECLINED",
  WITHDRAWN: "cases.requestStates.WITHDRAWN",
} as const satisfies Record<string, TranslationKey>;

const DATA_REQUEST_STATE_BADGE_TONE = {
  DRAFT: STATUS_TONE.idle,
  SUBMITTED: STATUS_TONE.fresh,
  IN_PROGRESS: STATUS_TONE.progress,
  CHANGES_REQUESTED: STATUS_TONE.changed,
  DELIVERED: STATUS_TONE.done,
  DECLINED: STATUS_TONE.error,
  WITHDRAWN: STATUS_TONE.archived,
} as const;

export type DataRequestStateKey = keyof typeof DATA_REQUEST_STATE_BADGE_LABELS;

function isDataRequestStateKey(value: string): value is DataRequestStateKey {
  return value in DATA_REQUEST_STATE_BADGE_LABELS;
}

export function getDataRequestStateBadgeLabel(
  state?: string | null,
): TranslationKey {
  if (!state) return DATA_REQUEST_STATE_BADGE_LABELS.DRAFT;
  const upper = state.toUpperCase();
  if (isDataRequestStateKey(upper)) {
    return DATA_REQUEST_STATE_BADGE_LABELS[upper];
  }
  return DATA_REQUEST_STATE_BADGE_LABELS.DRAFT;
}

export function getDataRequestStateBadgeTone(state?: string | null): string {
  if (!state) return DATA_REQUEST_STATE_BADGE_TONE.DRAFT;
  const upper = state.toUpperCase();
  if (isDataRequestStateKey(upper)) {
    return DATA_REQUEST_STATE_BADGE_TONE[upper];
  }
  return DATA_REQUEST_STATE_BADGE_TONE.DRAFT;
}
