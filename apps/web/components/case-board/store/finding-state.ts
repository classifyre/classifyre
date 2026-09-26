import type { BubbleRow, FindingVisualState, SeverityKey } from "./types";

/**
 * The six visible finding states, highest priority first. Every state is
 * self-labelled with a text chip on the row: colour is never the only signal
 * (PRD §5.2, §5.9).
 */
export function findingVisualState(n: {
  missing?: boolean | null;
  matchState?: string | null;
  status?: string | null;
}): FindingVisualState {
  if (n.missing) return "deleted";
  if (n.matchState === "GONE") return "gone";
  if (n.status === "RESOLVED") return "resolved";
  if (n.status === "FALSE_POSITIVE" || n.status === "IGNORED") return "dismissed";
  if (n.matchState === "NEW") return "new";
  return "open";
}

/** Row order inside a bubble: state first, then severity, then detector. */
export const STATE_ORDER: Record<FindingVisualState, number> = {
  new: 0,
  open: 1,
  resolved: 2,
  dismissed: 3,
  gone: 4,
  deleted: 5,
};

export const SEVERITY_ORDER: Record<SeverityKey, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const SEVERITY_KEYS: readonly SeverityKey[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export function normalizeSeverity(value: unknown): SeverityKey | null {
  if (typeof value !== "string") return null;
  const key = value.toLowerCase();
  return key in SEVERITY_ORDER ? (key as SeverityKey) : null;
}

export function compareRows(a: BubbleRow, b: BubbleRow): number {
  return (
    STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
    (a.severity ? SEVERITY_ORDER[a.severity] : 9) -
      (b.severity ? SEVERITY_ORDER[b.severity] : 9) ||
    (a.detector ?? "").localeCompare(b.detector ?? "") ||
    a.typeLabel.localeCompare(b.typeLabel) ||
    a.findingId.localeCompare(b.findingId)
  );
}

/** The dismissed chip says which kind of dismissal it was. */
export function dismissedLabel(status: string | null): "falsePositive" | "ignored" {
  return status === "IGNORED" ? "ignored" : "falsePositive";
}
